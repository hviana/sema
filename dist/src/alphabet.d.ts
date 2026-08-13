import { Vec } from "./vec.js";
import type { AlphabetConfig } from "./config.js";
export declare class Alphabet {
    readonly vecs: Vec[];
    readonly config: AlphabetConfig;
    constructor(seed: number, D: number, config?: Partial<AlphabetConfig>);
}
