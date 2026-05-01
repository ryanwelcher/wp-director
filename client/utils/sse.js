export async function readSSE(res, onMessage) {
  if (!res.body) throw new Error('Run response did not include a stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const line = event.replace(/^data: /, '').trim();
      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        onMessage(msg);
        if (msg.type === 'done') {
          await reader.cancel();
          return msg;
        }
      } catch {
        // Ignore malformed chunks and keep the stream alive.
      }
    }
  }

  return null;
}
