import {
  ActionRowBuilder,
  Attachment,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ColorResolvable,
  EmbedBuilder,
  GuildMember,
  GuildNSFWLevel,
  Message,
  TextChannel,
} from "discord.js";
import { DsuClient } from "lib/core/DsuClient";
import { EventLoader } from "lib/core/loader/EventLoader";
import { MentorModel } from "models/Mentor";
import { PhraseMatcherModel } from "models/PhraseMatcher";
import { SettingsModel } from "models/Settings";
import { TriggerModel } from "models/Trigger";

export default class MessageCreate extends EventLoader {
  constructor(client: DsuClient) {
    super(client, "messageCreate");
  }

  override async run(message: Message) {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (
      message.channel.type !== ChannelType.GuildText &&
      message.channel.type !== ChannelType.GuildVoice
    )
      return; // prevent running in dms, and use as guard clause
    if (message.guild && !this.client.settings.has((message.guild || {}).id)) {
      // We don't have the settings for this guild, find them or generate empty settings
      const s = await SettingsModel.findOneAndUpdate(
        { _id: message.guild.id },
        { toUpdate: true },
        {
          upsert: true,
          setDefaultsOnInsert: true,
          new: true,
        }
      )
        .populate("mentorRoles")
        .populate("commands");

      this.client.logger.info(
        `Setting sync: Fetch Database -> Client (${message.guild.id})`
      );

      this.client.settings.set(message.guild.id, s);
      message.settings = s;
    } else {
      const s = this.client.settings.get(
        message.guild ? message.guild.id : "default"
      );
      if (!s) return;
      message.settings = s;
    }
    const defaultUtility = this.client.utils.getUtility("default");

    const level = this.client.getPermLevel(message, message.member!);

    const autoSlowManager = await defaultUtility.getAutoSlow(message.channelId);

    if (
      autoSlowManager != null &&
      level < 1 &&
      message.channel instanceof TextChannel
    ) {
      autoSlowManager.messageSent();
      autoSlowManager.setOptimalSlowMode(message.channel);
    }

    if (level == -1) {
      return;
    }
    const linkUtility = this.client.utils.getUtility("linkHandler");
    const hasLink = linkUtility.parseMessageForLink(message.content);

    const canSendLinks = linkUtility.checkLinkPermissions(
      message.guildId ?? "",
      message.channelId,
      message.author.id,
      message.member?.roles.cache.map((role) => role.id) ?? []
    );

    if (!canSendLinks && hasLink.hasUrls && level < 3) {
      await message.delete().catch(() => {});
      return;
    }

    await this.client.utils.getUtility("anchors").handleAnchor(message);

    message.author.permLevel = level;

    const foundPhrases = await PhraseMatcherModel.find();

    for (const { phrases, logChannelId } of foundPhrases) {
      for (const { content, matchThreshold } of phrases) {
        const matches = defaultUtility.fuzzyMatch(message.content, content);
        if (matches >= matchThreshold) {
          const logChannel = message.guild.channels.cache.get(logChannelId);
          if (
            logChannel &&
            logChannel.guild != null &&
            (logChannel.type === ChannelType.GuildText || logChannel.isThread())
          ) {
            const embed = new EmbedBuilder()
              .setTitle("Matched message")
              .setColor(matches === 100 ? "Green" : "Yellow")
              .setDescription(`[Jump to message](${message.url})`)
              .setFields([
                {
                  name: `Message`,
                  value: message.content,
                },
                {
                  name: "Phrase",
                  value: content,
                },
                {
                  name: "Author",
                  value: message.author.id,
                },
                {
                  name: "Threshold match (%)",
                  value: `${Math.round(matches)}%`,
                },
              ]);
            await logChannel.send({ embeds: [embed] });
          }
        }
      }
    }

    const triggers = message.settings.triggers.filter((t) => t.enabled);
    for (const trigger of triggers) {
      const id = `trigger-${trigger.id}`;
      const optedOut = await TriggerModel.exists({
        guildId: message.guild.id,
        userId: message.author.id,
        triggerId: id,
      });

      if (optedOut) {
        continue;
      }
      if (this.client.dirtyCooldownHandler.has(id)) {
        const matched: string[] = [];
        const allMatch =
          trigger.keywords.length != 0 &&
          trigger.keywords.every((keywordArr) =>
            keywordArr
              .map(
                (v) =>
                  new RegExp(v.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1"), "i")
              )
              .some(
                (k) =>
                  message.content.match(k) &&
                  matched.push(k.source) &&
                  // Ignore trigger content if matched trigger is a custom emoji's name.
                  message.content.match(/<a?:.+?:\d+>/)?.length == 0
              )
          );

        if (allMatch) {
          const button = new ActionRowBuilder<ButtonBuilder>().setComponents(
            new ButtonBuilder()
              .setCustomId(id)
              .setLabel("Don't remind me again")
              .setStyle(ButtonStyle.Primary)
          );

          let reply: {
            content?: string;
            embeds?: EmbedBuilder[];
            components: ActionRowBuilder<ButtonBuilder>[];
          };

          if (trigger.message.embed) {
            let color: ColorResolvable = "Red";

            const footer = `Matched: ${matched
              .map((m) => `"${m}"`)
              .join(", ")}`;

            if (defaultUtility.isColor(trigger.message.color)) {
              color = trigger.message.color;
            }

            reply = {
              embeds: [
                new EmbedBuilder()
                  .setTitle(trigger.message.title)
                  .setDescription(trigger.message.description)
                  .setColor(color)
                  .setFooter({ text: footer }),
              ],
              components: [button],
            };
          } else {
            reply = {
              content: trigger.message.content,
              components: [button],
            };
          }

          message
            .reply(reply)
            .then(() => {
              this.client.dirtyCooldownHandler.set(id, trigger.cooldown * 1000);
            })
            .catch();

          break; // Don't want multiple triggers on a single message
        }
      }
    }
    // auto-resolve discord urls
    //
    if (message.content.match(/discord\.gg\/([a-zA-Z0-9]+)/g)) {
      const matches = [
        ...message.content.matchAll(/discord\.gg\/([a-zA-Z0-9]+)/g),
      ];

      matches.forEach(async (match) => {
        const code = match[1];
        console.log(`discord.gg/${code}`);
        try {
          const server = await this.client.fetchInvite(code);
          if (!server.guild) return;

          const embed = this.client.utils
            .getUtility("default")
            .generateEmbed("success", {
              title: "Resolved guild",
              description: `Name: ${server.guild.name}`,
              fields: [
                {
                  name: "NSFW Level",
                  value: `${GuildNSFWLevel[server.guild.nsfwLevel]}`,
                },
              ],
            });
          await message.reply({ embeds: [embed] }).then((msg) => {
            msg.reply(`Server avatar: ||${server.guild?.iconURL()}||`);
          });
        } catch (e) {
          const embed = this.client.utils
            .getUtility("default")
            .generateEmbed("error", {
              title: "Failed to resolve guild",
              description: `Guild may be banned, deleted, or the invite expired.`,
            });
          message.reply({ embeds: [embed] });
        }
      });
    }
    this.client.textCommandLoader.handle(message);
  }
}
