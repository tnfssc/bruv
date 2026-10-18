/**
 * What kind of turn the user's words are, so the filler fits: "hey" to a hello, "hmm" to a question, "okay"
 * to a request. Plain rules got about half right on phrases they hadn't seen. A small model (e5-small, 33M)
 * got 84 to 93%, but needs a 300 MB runtime; this gets 81 to 92% with none, in a hundredth of a millisecond.
 * It is a linear classifier over the words, word pairs and pieces of words, learnt in a few hundred ms from
 * labelled examples, so a turn that gets the wrong kind is fixed by adding it to them.
 *
 * Good and bad news are learnt apart but give one kind: telling "sign ups doubled" from "the memory leak is
 * back" takes knowing the world, and "oh nice" to bad news is the worst sound of all. A turn it isn't sure
 * of gets none: a wrong sound is worse than silence.
 */
export type Kind = "greeting" | "question" | "request" | "news";
const labels = ["greeting", "question", "request", "bad", "good", "none"] as const;
type Label = (typeof labels)[number];

export type Example = { text: string; label: string };

/** The words of `text`, and its word pairs and letter runs of 2 to 5 inside each word, with how often each comes. */
function grams(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const word = new Map<string, number>();
  const piece = new Map<string, number>();
  const add = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  words.forEach((w, i) => {
    add(word, w);
    if (i) add(word, `${words[i - 1]} ${w}`);
    const padded = ` ${w} `;
    for (let n = 2; n <= 5; n++) for (let at = 0; at + n <= padded.length; at++) add(piece, padded.slice(at, at + n));
  });
  return [word, piece];
}

type Vector = { index: Int32Array; value: Float32Array };

export class Kinds {
  private vocabulary = new Map<string, number>();
  private idf: number[] = [];
  private weights: Float32Array;
  private bias = new Float32Array(labels.length);

  constructor(examples: Example[], epochs = 12) {
    const docs = examples.map(({ text }) => grams(text));
    // Weigh down what most examples have, by how many they appear in.
    const seen: number[] = [];
    for (const doc of docs)
      for (const [b, map] of doc.entries())
        for (const key of map.keys()) {
          const name = `${b}${key}`;
          let at = this.vocabulary.get(name);
          if (at === undefined) {
            at = this.vocabulary.size;
            this.vocabulary.set(name, at);
            seen.push(0);
          }
          seen[at]++;
        }
    this.idf = seen.map((count) => Math.log((1 + docs.length) / (1 + count)) + 1);
    this.weights = new Float32Array(this.vocabulary.size * labels.length);
    const vectors = docs.map((doc) => this.vector(doc));
    const targets = examples.map(({ label }) => labels.indexOf(label as Label));
    if (targets.includes(-1)) throw new Error(`Unknown label in ${examples[targets.indexOf(-1)].text}`);
    this.train(vectors, targets, epochs);
  }

  /** Each block scaled to length one, so long turns and short ones count alike. */
  private vector(doc: Map<string, number>[]): Vector {
    const index: number[] = [];
    const value: number[] = [];
    doc.forEach((map, b) => {
      const start = value.length;
      for (const [key, count] of map) {
        const at = this.vocabulary.get(`${b}${key}`);
        if (at === undefined) continue;
        index.push(at);
        value.push((1 + Math.log(count)) * this.idf[at]);
      }
      let sum = 0;
      for (let i = start; i < value.length; i++) sum += value[i] * value[i];
      const norm = Math.sqrt(sum) || 1;
      for (let i = start; i < value.length; i++) value[i] /= norm;
    });
    return { index: Int32Array.from(index), value: Float32Array.from(value) };
  }

  private scores({ index, value }: Vector) {
    const out = Float64Array.from(this.bias);
    for (let i = 0; i < index.length; i++) {
      const row = index[i] * labels.length;
      for (let k = 0; k < labels.length; k++) out[k] += value[i] * this.weights[row + k];
    }
    const top = Math.max(...out);
    let sum = 0;
    for (let k = 0; k < out.length; k++) sum += out[k] = Math.exp(out[k] - top);
    return out.map((score) => score / sum);
  }

  /** Logistic regression by stochastic gradient descent, in a fixed order so it learns the same each time. */
  private train(vectors: Vector[], targets: number[], epochs: number) {
    const order = vectors.map((_, i) => i);
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const decay = 1e-5;
    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const rate = 0.5 / (1 + epoch * 0.2);
      for (const n of order) {
        const vector = vectors[n];
        const p = this.scores(vector);
        for (let k = 0; k < labels.length; k++) {
          const error = p[k] - (k === targets[n] ? 1 : 0);
          this.bias[k] -= rate * error;
          for (let i = 0; i < vector.index.length; i++) {
            const at = vector.index[i] * labels.length + k;
            this.weights[at] -= rate * (error * vector.value[i] + decay * this.weights[at]);
          }
        }
      }
    }
  }

  /** How likely each label is for `heard`. */
  odds(heard: string) {
    const p = this.scores(this.vector(grams(heard)));
    return Object.fromEntries(labels.map((label, k) => [label, p[k]])) as Record<Label, number>;
  }

  /** The kind of `heard`, or undefined when it's none of them or the guess is unsure. */
  of(heard: string, sure = 0.6): Kind | undefined {
    const { bad, good, ...odds } = this.odds(heard);
    const all = { ...odds, news: bad + good };
    const best = (Object.keys(all) as (Kind | "none")[]).reduce((a, b) => (all[b] > all[a] ? b : a));
    return best !== "none" && all[best] >= sure ? best : undefined;
  }
}
