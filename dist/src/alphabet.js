// alphabet.ts — the byte→vector mapping.
//
// 256 unit vectors, one per byte value, built by recursive refinement:
// 16 coarse directions → 64 mids → 256 fines. Same-fine neighbours
// resonate; far-apart values are quasi-orthogonal.
import { addInto, copy, normalize, randomUnit, rng } from "./vec.js";
export class Alphabet {
    vecs = [];
    config;
    constructor(seed, D, config) {
        this.config = {
            roughness: config?.roughness ?? 0.65,
            seedMask: config?.seedMask ?? 0xa1fa17,
        };
        const rand = rng((seed ^ this.config.seedMask) >>> 0);
        const refine = (parent) => {
            const v = copy(parent);
            for (let i = 0; i < v.length; i++) {
                v[i] *= Math.sqrt(1 - this.config.roughness);
            }
            addInto(v, randomUnit(D, rand), Math.sqrt(this.config.roughness));
            return normalize(v);
        };
        const coarse = [];
        for (let i = 0; i < 16; i++)
            coarse.push(randomUnit(D, rand));
        const mid = [];
        for (let i = 0; i < 64; i++)
            mid.push(refine(coarse[i >> 2]));
        for (let b = 0; b < 256; b++)
            this.vecs.push(refine(mid[b >> 2]));
    }
}
