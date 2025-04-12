import { DsuClient } from "lib/core/DsuClient";
import { ClientUtilities } from "lib/core/ClientUtilities";

const confirmationTimeoutPeriod = 15000;

const emojiBan = "emojiBan";

export class EmojiSuggestionsUtility extends ClientUtilities {
  constructor(client: DsuClient) {
    super(client);
  }

  // TODO
}
