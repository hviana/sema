// config.ts — the single configuration interface for Sema.
// Every tunable parameter lives here. Subsystems receive their subset.
// ── Defaults ──
export const DEFAULT_CONFIG = {
    seed: 42,
    recallQueryK: 12,
    haloQueryK: 12,
    normalizeEpsilon: 1e-12,
    cosineEpsilon: 1e-12,
    alu: {
        enabled: true,
        tol: 1e-10,
        maxIter: 1000,
        precision: 6,
    },
    geometry: {
        maxGroup: 4,
    },
    alphabet: {
        roughness: 0.65,
        seedMask: 0xa1fa17,
    },
    store: {
        minHaloMass: 1,
        m: 8,
        efConstruction: 64,
        efConstructionInterior: 16,
        efSearch: 64,
        compactEveryNWrites: 50_000,
        overfetch: 4,
        batchSize: 256,
        dedupCacheMax: 1_000_000,
        bytesCacheMax: 20_000_000,
        recCacheBytes: 10_000_000,
        ingestCacheBytes: 50_000_000,
        pendingGistBytes: 16_000_000,
        haloCacheBytes: 16_000_000,
        vectorCacheMb: 64,
        coveredIdsMax: 100_000,
        chainCacheBytes: 16_000_000,
    },
};
// ── Config resolver: partial input + defaults = full config ──
export function resolveConfig(opts = {}) {
    return {
        seed: opts.seed ?? DEFAULT_CONFIG.seed,
        recallQueryK: opts.recallQueryK ?? DEFAULT_CONFIG.recallQueryK,
        haloQueryK: opts.haloQueryK ?? DEFAULT_CONFIG.haloQueryK,
        normalizeEpsilon: opts.normalizeEpsilon ?? DEFAULT_CONFIG.normalizeEpsilon,
        cosineEpsilon: opts.cosineEpsilon ?? DEFAULT_CONFIG.cosineEpsilon,
        alu: {
            enabled: opts.alu?.enabled ?? DEFAULT_CONFIG.alu.enabled,
            tol: opts.alu?.tol ?? DEFAULT_CONFIG.alu.tol,
            maxIter: opts.alu?.maxIter ?? DEFAULT_CONFIG.alu.maxIter,
            precision: opts.alu?.precision ?? DEFAULT_CONFIG.alu.precision,
        },
        geometry: {
            maxGroup: opts.geometry?.maxGroup ?? DEFAULT_CONFIG.geometry.maxGroup,
        },
        alphabet: {
            roughness: opts.alphabet?.roughness ?? DEFAULT_CONFIG.alphabet.roughness,
            seedMask: opts.alphabet?.seedMask ?? DEFAULT_CONFIG.alphabet.seedMask,
        },
        store: {
            minHaloMass: opts.store?.minHaloMass ?? DEFAULT_CONFIG.store.minHaloMass,
            m: opts.store?.m ?? DEFAULT_CONFIG.store.m,
            efConstruction: opts.store?.efConstruction ??
                DEFAULT_CONFIG.store.efConstruction,
            efConstructionInterior: opts.store?.efConstructionInterior ??
                DEFAULT_CONFIG.store.efConstructionInterior,
            efSearch: opts.store?.efSearch ?? DEFAULT_CONFIG.store.efSearch,
            compactEveryNWrites: opts.store?.compactEveryNWrites ??
                DEFAULT_CONFIG.store.compactEveryNWrites,
            overfetch: opts.store?.overfetch ?? DEFAULT_CONFIG.store.overfetch,
            batchSize: opts.store?.batchSize ?? DEFAULT_CONFIG.store.batchSize,
            dedupCacheMax: opts.store?.dedupCacheMax ??
                DEFAULT_CONFIG.store.dedupCacheMax,
            bytesCacheMax: opts.store?.bytesCacheMax ??
                DEFAULT_CONFIG.store.bytesCacheMax,
            recCacheBytes: opts.store?.recCacheBytes ??
                DEFAULT_CONFIG.store.recCacheBytes,
            ingestCacheBytes: opts.store?.ingestCacheBytes ??
                DEFAULT_CONFIG.store.ingestCacheBytes,
            pendingGistBytes: opts.store?.pendingGistBytes ??
                DEFAULT_CONFIG.store.pendingGistBytes,
            haloCacheBytes: opts.store?.haloCacheBytes ??
                DEFAULT_CONFIG.store.haloCacheBytes,
            vectorCacheMb: opts.store?.vectorCacheMb ??
                DEFAULT_CONFIG.store.vectorCacheMb,
            coveredIdsMax: opts.store?.coveredIdsMax ??
                DEFAULT_CONFIG.store.coveredIdsMax,
            chainCacheBytes: opts.store?.chainCacheBytes ??
                DEFAULT_CONFIG.store.chainCacheBytes,
        },
    };
}
