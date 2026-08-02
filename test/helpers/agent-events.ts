export const codexAgentMessage = (text: string): string =>
  `printf '%s\\n' '${JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text },
  })}'`;

export const codexCompletionEvent = (
  status: "completed" | "incomplete",
  summary: string,
): string =>
  codexAgentMessage(
    `<lfi:completion>\n${JSON.stringify({ status, summary })}\n</lfi:completion>`,
  );
