import type { OperationRegistry } from "./operation.js";
/** Register the logic layer into `r`.  Idempotent in effect (re-registering
 *  overwrites with the same definitions). */
export declare function registerLogic(r: OperationRegistry): void;
