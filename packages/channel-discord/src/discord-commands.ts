const DISCORD_API_BASE = "https://discord.com/api/v10";

export type SlashCommandDefinition = {
  name: string;
  description: string;
  options?: Array<{
    name: string;
    description: string;
    type: number;
    required?: boolean;
  }>;
};

export async function registerGlobalCommands(
  applicationId: string,
  token: string,
  commands: SlashCommandDefinition[],
): Promise<void> {
  const response = await fetch(`${DISCORD_API_BASE}/applications/${applicationId}/commands`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify(commands),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to register commands (${response.status}): ${text}`);
  }
}
