import {
  ApplicationCommandType,
  CommandInteraction,
  GuildMember,
  MessageContextMenuCommandInteraction,
  MessageFlags,
  PermissionsBitField,
  UserContextMenuCommandInteraction,
} from "discord.js";
import { ApplicationCommand } from "lib/core/command";
import { DsuClient } from "lib/core/DsuClient";

export default class AsciiName extends ApplicationCommand {
  constructor(client: DsuClient) {
    super("ASCII Name", client, {
      type: ApplicationCommandType.User,
      permissionLevel: "USER",
      defaultMemberPermissions: new PermissionsBitField("Administrator"),
    });
  }

  public async run(interaction: UserContextMenuCommandInteraction) {
    if (!(interaction.targetMember instanceof GuildMember)) {
      return interaction.reply({
        content: "ASCII name only works on guild members",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (this.client.getPermLevel(undefined, interaction.targetMember) >= 2) {
      return interaction.reply({
        content: "Helper and above cannot be nicknamed",
        flags: MessageFlags.Ephemeral,
      });
    }
    const unicodeName = interaction.targetMember.user.username;
    const name = this.client.utils
      .getUtility("default")
      .unicodeToAscii(unicodeName);
    if (name.length < 3) {
      return interaction.reply({
        content: "Name couldn't be converted to ASCII",
        flags: MessageFlags.Ephemeral,
      });
    }
    interaction.targetMember, name;
    return interaction.reply({
      content: "User renamed successfully",
      flags: MessageFlags.Ephemeral,
    });
  }
}
