import { DsuClient } from "../core/DsuClient";
import { readdirSync } from "fs";
import { resolve } from "path";
import { ClientUtilities } from "lib/core/ClientUtilities";
import {
  APIEmbed,
  ColorResolvable,
  Colors,
  EmbedBuilder,
  GuildMember,
  Message,
} from "discord.js";
import { AutoSlowModel } from "models/AutoSlow";
import { AutoSlowUtility } from "../../src/utilities/autoSlow";
import { NameModel } from "models/Name";

export default class DefaultClientUtilities extends ClientUtilities {
  constructor(client: DsuClient) {
    super(client);
  }

  readFiles(directory: string, extension: string = ""): string[] {
    const files: string[] = [];
    readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const entryPath = resolve(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...this.readFiles(entryPath, extension));
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        files.push(entryPath);
      }
    });

    return files;
  }

  unicode2Ascii(name: string): string {
    const asciiNameNfkd = name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");
    const finalNameNfkd = this.eliminateUnicode(asciiNameNfkd);
    if (finalNameNfkd.length > 2) {
      return finalNameNfkd;
    }
    return "";
  }

  eliminateUnicode(name: string): string {
    let finalName = "";
    for (let char = 0; char < name.length; char++) {
      if (name.charCodeAt(char) < 128) {
        finalName += name[char];
      }
    }
    return finalName;
  }

  isColor(value: any): value is ColorResolvable {
    if (value == null || value == undefined) {
      return false;
    }

    if (value in Colors) {
      return true;
    }

    if (
      typeof value === "string" &&
      /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(value)
    ) {
      return true;
    }

    if (value === "Random") {
      return true;
    }

    if (typeof value === "number") {
      return true;
    }

    if (
      Array.isArray(value) &&
      value.length === 3 &&
      value.every((num) => typeof num === "number")
    ) {
      return true;
    }

    return false;
  }

  fuzzyMatch(message: string, phrase: string): number {
    const msg = message.toLowerCase();
    const phr = phrase.toLowerCase();

    const lenA = msg.length;
    const lenB = phr.length;

    if (lenA === 0) return lenB === 0 ? 100 : 0;
    if (lenB === 0) return 0;

    if (msg.includes(phr)) {
      return (lenB / lenA) * 100;
    }

    const dp = Array.from({ length: lenA + 1 }, () => Array(lenB + 1).fill(0));

    for (let i = 1; i <= lenA; i++) {
      for (let j = 1; j <= lenB; j++) {
        const areSimilar = this.isSimilar(msg[i - 1], phr[j - 1]);

        const cost = msg[i - 1] === phr[j - 1] ? 0 : areSimilar ? 0.5 : 1;

        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    const editDistance = dp[lenA][lenB];

    const maxLen = Math.max(lenA, lenB);
    const similarity = ((maxLen - editDistance) / maxLen) * 100;

    return Math.max(0, similarity);
  }

  isSimilar = (a: string, b: string) => {
    const similarPairs = [
      ["rn", "m"],
      ["0", "o"],
      ["1", "l"],
      ["5", "s"],
      ["2", "z"],
      ["ph", "f"],
      ["c", "k"],
      ["v", "w"],
      ["u", "v"],
      ["3", "e"],
      ["4", "a"],
    ];

    return similarPairs.some(
      ([x, y]) => (a === x[0] && b === x[1]) || (a === y[0] && b === y[1])
    );
  };

  generateEmbed(
    type: "success" | "warning" | "error" | "general",
    data: APIEmbed
  ) {
    const embed = new EmbedBuilder(data);
    switch (type) {
      case "success":
        embed.setColor(this.client.config.colors.success);
        break;
      case "warning":
        embed.setColor(this.client.config.colors.warning);
        break;
      case "error":
        embed.setColor(this.client.config.colors.error);
        break;
      case "general":
        embed.setColor(this.client.config.colors.primary);
        break;
    }
    return embed;
  }

  async addAutoSlow(
    channelId: string,
    min: number,
    max: number,
    targetMsgsPerSec: number,
    minChange: number,
    minChangeRate: number,
    enabled: boolean
  ) {
    const autoSlow = new AutoSlowUtility(this.client);
    autoSlow.setAutoSlowParams(
      min,
      max,
      targetMsgsPerSec,
      minChange,
      minChangeRate,
      enabled
    );

    autoSlow.addToCache(channelId);

    await AutoSlowModel.findOneAndUpdate(
      { channelId },
      { min, max, targetMsgsPerSec, minChange, minChangeRate, enabled },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return autoSlow;
  }

  async removeAutoSlow(channelId: string): Promise<void> {
    this.client.utils.getUtility("autoSlow").cache.delete(channelId);
    await AutoSlowModel.deleteOne({ channelId: channelId });
  }

  async getAutoSlow(channelId: string) {
    let autoSlow = this.client.utils
      .getUtility("autoSlow")
      .cache.get(channelId);
    if (!autoSlow) {
      const autoSlowConfig = await AutoSlowModel.findOne({
        channelId,
      });
      if (!autoSlowConfig) return;

      autoSlow = new AutoSlowUtility(this.client);
      let { min, max, targetMsgsPerSec, minChange, minChangeRate, enabled } =
        autoSlowConfig;
      autoSlow.setAutoSlowParams(
        min,
        max,
        targetMsgsPerSec,
        minChange,
        minChangeRate,
        enabled
      );

      this.client.utils.getUtility("autoSlow").cache.set(channelId, autoSlow);

      return autoSlow;
    }
  }

  async getNameFromMemory(userId: string, guildId: string) {
    const response = await NameModel.findOne({
      userId,
      guildId,
    });

    if (!response) return "";

    return response.name;
  }

  async setNameInMemory(userId: string, guildId: string, name: string) {
    const filter = {
      userId,
      guildId,
    };

    await NameModel.findOne(filter, { name }, { upsert: true });
  }
}
