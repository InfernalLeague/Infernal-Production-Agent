import type { AllGameData } from "../types.js";

/** Společné rozhraní: reálné Live API i mock ho implementují. */
export interface LiveDataSource {
  allGameData(): Promise<AllGameData>;
}
