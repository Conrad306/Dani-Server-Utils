import { DsuClient } from "lib/core/DsuClient";
import { UtilityInstanceMap, UtilityKey, utilities } from "types/index";

export class UtilitiesManager {
  private client: DsuClient;
  private utils: Partial<UtilityInstanceMap> = {};

  constructor(client: DsuClient) {
    this.client = client;
  }

  public getUtility<K extends UtilityKey>(key: K): UtilityInstanceMap[K] {
    if (!this.utils[key]) {
      const UtilityClass = utilities[key];
      this.utils[key] = new UtilityClass(this.client);
    }

    // Now returns the actual instance, fully typed
    return this.utils[key]!;
  }
}
