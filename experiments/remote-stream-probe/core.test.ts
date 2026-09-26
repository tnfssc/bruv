import { test } from "node:test";
import { strict as assert } from "node:assert";
import { Log, Notices, Replica } from "./core.ts";
test("ordered cursor and replay dedupe; gap/epoch explicit", () => {
	const l = new Log(4096, "one"),
		r = new Replica("one");
	const a = l.add(1, "acceptance"),
		b = l.add(1, "result");
	r.apply([a, a, b]);
	assert.equal(r.cursor, 2);
	assert.throws(() => r.apply([{ ...a, text: "altered" }]), /conflicting/);
	assert.throws(() => new Replica("one").apply([b]), /gap/);
	assert.throws(() => r.apply([{ ...b, epoch: "two", cursor: 3 }]), /epoch/);
	assert.equal(l.page(0, "other").unavailable, true);
});
test("bounded notification queue and independent bounded authoritative history", () => {
	const l = new Log(400),
		q = new Notices(180);
	for (let i = 0; i < 20; i++) q.push(l.add(1, "progress"));
	assert.ok(q.peak <= q.cap);
	assert.equal(q.drain().gap, true);
	assert.equal(l.page(0, l.epoch).unavailable, true);
	assert.equal(l.page(l.cursor - 1, l.epoch).events.length, 1);
});

test("oversized add does not consume cursor; page is count and full-frame byte bounded", () => {
	const l = new Log(200_000, "bounds");
	assert.throws(() => l.add(1, "transcript", "x".repeat(40_000)), /larger/);
	assert.equal(l.cursor, 0);
	for (let i = 0; i < 130; i++) l.add(1, "transcript", "x".repeat(800));
	let cursor = 0,
		pages = 0;
	do {
		const p = l.page(cursor, l.epoch);
		assert.ok(Buffer.byteLength(JSON.stringify(p)) <= 32 * 1024);
		assert.ok(p.events.length <= 64);
		assert.ok(p.events.length > 0);
		assert.equal(p.events[0]!.cursor, cursor + 1);
		cursor = p.cursor;
		pages++;
		assert.equal(p.more, cursor < l.cursor);
	} while (cursor < l.cursor);
	assert.equal(cursor, 130);
	assert.ok(pages > 2);
});
