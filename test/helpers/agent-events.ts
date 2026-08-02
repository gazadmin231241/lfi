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

export const piCompletionEvent = (
  status: "completed" | "incomplete",
  summary: string,
): string =>
  `printf '%s\\n' '${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{
        type: "text",
        text: `<lfi:completion>\n${JSON.stringify({ status, summary })}\n</lfi:completion>`,
      }],
    },
  })}'`;
