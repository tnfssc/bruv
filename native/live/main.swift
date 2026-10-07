import Foundation
import AVFoundation
import Darwin

// Input tap never emits JSON or allocates: it copies at most 1024 mono frames into a bounded SPSC ring.
// Output callback only pulls from the bounded PCM ring. The command queue alone produces playback.
final class CaptureResampler {
    private var converter: AVAudioConverter?
    private var sourceFormat: AVAudioFormat?
    private var targetFormat: AVAudioFormat?
    private var pending = Data()
    private var rate: Double = 0
    func reset() { converter = nil; sourceFormat = nil; targetFormat = nil; pending.removeAll(keepingCapacity: true); rate = 0 }
    func feed(_ samples: UnsafeBufferPointer<Float>, rate newRate: Double, emit: (Data) -> Void) {
        guard newRate >= 8000 && newRate <= 192000 && samples.count <= 1024 else { return }
        if newRate != rate {
            reset(); rate = newRate
            sourceFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: newRate, channels: 1, interleaved: false)
            targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)
            guard let sourceFormat, let targetFormat else { return }
            converter = AVAudioConverter(from: sourceFormat, to: targetFormat)
        }
        guard let sourceFormat, let targetFormat, let converter,
              let input = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: AVAudioFrameCount(samples.count)),
              let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: 4096),
              let inputData = input.floatChannelData?[0] else { return }
        input.frameLength = AVAudioFrameCount(samples.count)
        inputData.update(from: samples.baseAddress!, count: samples.count)
        var supplied = false
        while true {
            var failure: NSError?
            let status = converter.convert(to: output, error: &failure) { _, inputStatus in
                if supplied { inputStatus.pointee = .noDataNow; return nil }
                supplied = true; inputStatus.pointee = .haveData; return input
            }
            if failure != nil { reset(); return }
            if let data = output.floatChannelData?[0] {
                for i in 0..<Int(output.frameLength) {
                    let value = data[i]
                    let scaled = value.isFinite ? Int(max(-32768, min(32767, (Double(value) * 32768).rounded()))) : 0
                    let bits = UInt16(bitPattern: Int16(scaled))
                    pending.append(UInt8(truncatingIfNeeded: bits))
                    pending.append(UInt8(truncatingIfNeeded: bits >> 8))
                }
                while pending.count >= 640 {
                    emit(Data(pending.prefix(640)))
                    pending.removeFirst(640)
                }
            }
            if status != .haveData || output.frameLength == 0 { break }
        }
    }
}

func parse(_ line: String) -> [String: Any]? {
    guard let data = line.data(using: .utf8), data.count <= 1_000_000,
          let value = try? JSONSerialization.jsonObject(with: data),
          let object = value as? [String: Any], object["type"] is String else { return nil }
    return object
}
func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let n = number.doubleValue
    guard n.isFinite && n >= 0 && n <= Double(Int32.max) && n.rounded() == n else { return nil }
    return Int(n)
}
import CoreFoundation

if CommandLine.arguments.count > 1 {
    switch CommandLine.arguments[1] {
    case "--help":
        print("live-audio: JSON lines on stdin/stdout. Commands: start, play(data, generation), flush(generation), capture_gate(epoch|null), stop. Run --self-test without devices.")
        exit(0)
    case "--self-test":
        let resampler = CaptureResampler()
        let input = [Float](repeating: 0.25, count: 48000)
        var frames = 0
        for start in stride(from: 0, to: input.count, by: 1024) {
            input[start..<min(start + 1024, input.count)].withUnsafeBufferPointer { samples in
                resampler.feed(samples, rate: 48000) { data in
                    if data.count == 640 { frames += 1 }
                }
            }
        }
        guard ll_self_test() != 0, frames >= 49 && frames <= 50,
              parse("{\"type\":\"start\"}")?["type"] as? String == "start",
              parse("invalid") == nil, integer(1.5) == nil, integer(2) == 2 else {
            fputs("self-test failed\n", stderr); exit(1)
        }
        print("self-test passed: protocol, ring, flush, capture and 48k->16k framing")
        exit(0)
    default: fputs("unknown option; use --help\n", stderr); exit(2)
    }
}

// Main-thread producers submit bounded events. Only this queue consumes capture,
// converts PCM, and reports playback progress; realtime callbacks only touch core.
final class LiveOutput {
    private let core: OpaquePointer
    private let queue = DispatchQueue(label: "live.json-output")
    private let eventSlots = DispatchSemaphore(value: 32)
    private let resampler = CaptureResampler()
    private var timer: DispatchSourceTimer? // main thread starts/cancels polling
    private var captureRate: Double = 0 // remaining state belongs to queue
    private var running = false
    private var reportedQueuedMs = 0
    private var zeroSince: DispatchTime?

    init(core: OpaquePointer) { self.core = core }

    // A blocked stdout cannot buffer audio indefinitely: fail closed on backpressure.
    private func writeEvent(_ object: [String: Any]) {
        guard let bytes = try? JSONSerialization.data(withJSONObject: object) else { _exit(74) }
        var line = bytes; line.append(10)
        line.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let n = Darwin.write(STDOUT_FILENO, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if n > 0 { offset += n }
                else if n < 0 && errno == EINTR { continue }
                else { _exit(74) }
            }
        }
    }
    func event(_ object: [String: Any]) {
        eventSlots.wait() // never called from a realtime callback or the output queue
        queue.async { self.writeEvent(object); self.eventSlots.signal() }
    }
    func error(_ code: String, _ message: String) { event(["type":"error", "code":code, "message":message]) }

    func startPolling(captureRate: Double, ready: [String: Any]) {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + .milliseconds(10), repeating: .milliseconds(10))
        queue.sync {
            self.captureRate = captureRate
            self.resampler.reset()
            self.running = true
            self.reportedQueuedMs = 0
            self.zeroSince = nil
        }
        event(ready)
        timer.setEventHandler { [weak self] in self?.poll() }
        self.timer = timer
        timer.resume()
    }

    // Stop scheduling before hardware teardown. finishStop is the barrier that
    // drains already-enqueued work and publishes the stopped acknowledgement.
    func cancelPolling() { timer?.cancel(); timer = nil }

    func finishStop() {
        queue.sync {
            self.running = false
            self.discardCapture()
            self.reportedQueuedMs = 0
            self.zeroSince = nil
            _ = ll_capture_dropped(self.core)
            self.writeEvent(["type":"played", "queuedMs":0])
            self.writeEvent(["type":"stopped"])
        }
    }

    func captureGate(epoch: Int, cutoff: UInt64) {
        queue.sync {
            ll_capture_gate(self.core, Int32(epoch), cutoff)
            self.discardCapture()
        }
    }

    func flushed() {
        queue.sync {
            self.zeroSince = nil
            self.reportedQueuedMs = 0
            self.writeEvent(["type":"played", "queuedMs":0])
        }
    }

    private func discardCapture() {
        // Discard packet fragments and AVAudioConverter lookbehind/tails along
        // with queued input, so none can cross a stop or hold boundary.
        resampler.reset()
        var discarded = [Float](repeating: 0, count: Int(LL_CAPTURE_SAMPLES))
        discarded.withUnsafeMutableBufferPointer { ptr in
            while ll_capture_pop(core, ptr.baseAddress!) > 0 {}
        }
    }

    private func poll() {
        guard running else { return }
        drainCapture()
        let dropped = ll_capture_dropped(core)
        if dropped > 0 { writeEvent(["type":"error", "code":"capture_overflow", "message":"Capture ring overflow: \(dropped) frames lost"]) }
        let queued = Int(ll_queued_ms(core))
        if queued > 0 { zeroSince = nil }
        else if zeroSince == nil { zeroSince = .now() }
        // Ring drained does not certify mixer/OS/hardware silence.
        let visible = queued == 0 && DispatchTime.now().uptimeNanoseconds - (zeroSince?.uptimeNanoseconds ?? 0) < 200_000_000 ? max(1, reportedQueuedMs) : queued
        if visible != reportedQueuedMs {
            reportedQueuedMs = visible
            writeEvent(["type":"played", "queuedMs":visible])
        }
    }

    private func drainCapture() {
        guard running else { return }
        var samples = [Float](repeating: 0, count: 1024)
        samples.withUnsafeMutableBufferPointer { ptr in
            while true {
                var epoch: Int32 = -1
                let n = Int(ll_capture_pop_epoch(core, ptr.baseAddress!, &epoch))
                if n <= 0 { break }
                guard epoch == ll_capture_current_epoch(core), epoch != -1 else { continue }
                resampler.feed(UnsafeBufferPointer(start: ptr.baseAddress!, count: n), rate: captureRate) { data in
                    var message: [String: Any] = ["type":"capture", "data":data.base64EncodedString()]
                    if epoch >= 0 { message["epoch"] = Int(epoch) }
                    self.writeEvent(message)
                }
            }
        }
    }
}

final class Live {
    private let core: OpaquePointer
    let output: LiveOutput
    private var engine: AVAudioEngine?
    private var notification: NSObjectProtocol?
    private var starting = false
    private var lastCaptureEpoch = -1
    let inputSlots = DispatchSemaphore(value: 8)

    init() {
        let core = ll_create()!
        self.core = core
        output = LiveOutput(core: core)
    }

    func start() {
        guard engine == nil && !starting else { output.error("state", "Audio is already starting or running"); return }
        starting = true
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: open()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    if !self.starting { return }
                    if granted { self.open() }
                    else { self.starting = false; self.output.error("permission", "Microphone permission denied") }
                }
            }
        default: starting = false; output.error("permission", "Microphone permission denied")
        }
    }
    // Only structured, bounded error metadata crosses the helper boundary.
    func setupError(_ phase: String, _ cause: Error) {
        let ns = cause as NSError
        let domain = ns.domain
        var payload: [String: Any] = ["type":"error", "code":phase,
            "message":"Could not start default audio route with voice processing"]
        if ["NSOSStatusErrorDomain","AVFoundationErrorDomain","NSCocoaErrorDomain","NSPOSIXErrorDomain","input-format","output-format","voice-processing"].contains(domain) && ns.code >= -2147483648 && ns.code <= 2147483647 {
            payload["domain"] = domain
            payload["number"] = ns.code
        }
        output.event(payload)
    }
    func open() {
        guard starting else { return }
        let audio = AVAudioEngine()
        var phase = "voice_processing"
        var tapInstalled = false
        do {
            try audio.inputNode.setVoiceProcessingEnabled(true)
            // AVEchoTouch uses this input I/O node property to bypass processing.
            // Our full-duplex tap must receive processed capture.
            audio.inputNode.isVoiceProcessingBypassed = false
            guard audio.inputNode.isVoiceProcessingEnabled && !audio.inputNode.isVoiceProcessingBypassed else { throw NSError(domain: "voice-processing", code: 1) }
            phase = "input_format"
            let inputFormat = audio.inputNode.outputFormat(forBus: 0)
            guard inputFormat.channelCount > 0, inputFormat.commonFormat == .pcmFormatFloat32,
                  !inputFormat.isInterleaved, inputFormat.sampleRate >= 8000,
                  inputFormat.sampleRate <= 192000 else { throw NSError(domain: "input-format", code: 1) }
            phase = "output_format"
            // Voice processing can change I/O formats; wire the mixer to the actual
            // output I/O format before deriving the source rate (Apple AVEchoTouch).
            let outputFormat = audio.outputNode.inputFormat(forBus: 0)
            guard outputFormat.sampleRate >= 24000, outputFormat.sampleRate <= 192000,
                outputFormat.channelCount > 0,
                let sourceFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                    sampleRate: outputFormat.sampleRate, channels: 1, interleaved: false) else { throw NSError(domain: "output-format", code: 1) }
            let source = AVAudioSourceNode { [core, rate = outputFormat.sampleRate] _, _, frameCount, buffers -> OSStatus in
                let list = UnsafeMutableAudioBufferListPointer(buffers)
                guard list.count == 1, let first = list.first, let memory = first.mData,
                      first.mDataByteSize >= frameCount * 4 else { return -1 }
                let frames = Int(frameCount)
                ll_render(core, memory.assumingMemoryBound(to: Float.self), Int32(frames), rate)
                return noErr
            }
            phase = "output_connect"
            audio.connect(audio.mainMixerNode, to: audio.outputNode, format: outputFormat)
            phase = "source_attach"
            audio.attach(source)
            phase = "source_connect"
            audio.connect(source, to: audio.mainMixerNode, format: sourceFormat)
            phase = "tap_install"
            audio.inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [core] buffer, time in
                let epoch = ll_capture_epoch(core, time.isHostTimeValid ? time.hostTime : 0)
                guard epoch != -1 else { return }
                guard let channel = buffer.floatChannelData?[0] else { return }
                var offset = 0
                let length = Int(buffer.frameLength)
                while offset < length {
                    let n = min(Int(LL_CAPTURE_SAMPLES), length - offset)
                    _ = ll_capture_push_epoch(core, channel + offset, Int32(n), epoch)
                    offset += n
                }
            }
            tapInstalled = true
            notification = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: audio, queue: .main) { [weak self] _ in
                self?.output.error("route_lost", "Audio device route changed; restart with start after stop")
                self?.stop()
            }
            phase = "engine_start"
            try audio.start()
            guard audio.inputNode.isVoiceProcessingEnabled && !audio.inputNode.isVoiceProcessingBypassed else {
                throw NSError(domain: "voice-processing", code: 2)
            }
            engine = audio
            starting = false
            // Non-acoustic diagnostics; no samples or device identity in protocol events.
            output.startPolling(captureRate: inputFormat.sampleRate, ready: ["type":"ready", "voiceProcessingEnabled":audio.inputNode.isVoiceProcessingEnabled,
                "voiceProcessingBypassed":audio.inputNode.isVoiceProcessingBypassed,
                "captureRate":inputFormat.sampleRate, "renderRate":outputFormat.sampleRate,
                "captureChannels":audio.inputNode.outputFormat(forBus: 0).channelCount,
                "renderChannels":audio.outputNode.inputFormat(forBus: 0).channelCount])
        } catch {
            if tapInstalled { audio.inputNode.removeTap(onBus: 0) }
            if let notification { NotificationCenter.default.removeObserver(notification); self.notification = nil }
            audio.stop(); starting = false
            setupError(phase, error)
        }
    }
    func stop() {
        starting = false
        if let notification { NotificationCenter.default.removeObserver(notification); self.notification = nil }
        output.cancelPolling()
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop(); engine = nil
        ll_flush(core, ll_generation(core) + 1)
        output.finishStop()
    }
    func command(_ c: [String: Any]) {
        guard let type = c["type"] as? String else { output.error("protocol", "Missing type"); return }
        switch type {
        case "capture_gate":
            let epoch: Int
            if c["epoch"] is NSNull { epoch = -1 }
            else if let value = integer(c["epoch"]), value >= 0, value > lastCaptureEpoch {
                epoch = value; lastCaptureEpoch = value
            } else { output.error("capture_gate", "Invalid or reused hold epoch"); return }
            let cutoff = mach_absolute_time()
            output.captureGate(epoch: epoch, cutoff: cutoff)
        case "start": start()
        case "stop": stop()
        case "flush":
            guard let generation = integer(c["generation"]), generation > ll_generation(core) else {
                output.error("generation", "Flush generation must increase"); return
            }
            ll_flush(core, Int32(generation))
            output.flushed()
        case "play":
            guard engine != nil else { output.error("state", "Start audio before play"); return }
            guard let generation = integer(c["generation"]), generation == ll_generation(core),
                  let encoded = c["data"] as? String, encoded.count <= 64000,
                  let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, bytes.count % 2 == 0,
                  bytes.count <= 48000 else { output.error("play", "Invalid PCM16 data or generation"); return }
            let count = bytes.count / 2
            var samples = [Int16](repeating: 0, count: count)
            for i in 0..<count { samples[i] = Int16(bitPattern: UInt16(bytes[i*2]) | (UInt16(bytes[i*2+1]) << 8)) }
            let accepted = samples.withUnsafeBufferPointer { ptr in
                ll_play_push_batch(core, ptr.baseAddress!, Int32(count), Int32(generation)) != 0
            }
            if !accepted { output.error("playback_full", "Playback ring full; entire play command rejected"); return }
            output.event(["type":"played", "queuedMs":max(1, ll_queued_ms(core))])
        default: output.error("protocol", "Unknown command")
        }
    }
}
let flags = fcntl(STDOUT_FILENO, F_GETFL)
if flags < 0 || fcntl(STDOUT_FILENO, F_SETFL, flags | O_NONBLOCK) < 0 { _exit(74) }
let live = Live()
live.output.event(["type":"hello", "protocol":1, "captureGate":true])
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        live.inputSlots.wait()
        let parsed = parse(line)
        DispatchQueue.main.async {
            if let parsed { live.command(parsed) }
            else { live.output.error("protocol", "Invalid JSON command") }
            live.inputSlots.signal()
        }
    }
    DispatchQueue.main.async { live.stop(); exit(0) }
}
dispatchMain()
