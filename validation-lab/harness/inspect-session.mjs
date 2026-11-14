import { get } from 'node:http';

const serverUrl = 'http://127.0.0.1:4096';
const pw = 'WIUoALbabiovJiW3SvE10pZnv947oigFuz0MUZ5N4SA';
const authHeader = 'Basic ' + Buffer.from('opencode:' + pw).toString('base64');
const sessionId = process.argv[2] || 'ses_e267c4b55ffeJeqoSQGPIZjAUW';

const req = get(`${serverUrl}/api/session/${sessionId}/message`, {
  headers: { Authorization: authHeader }
}, res => {
  let raw = '';
  res.on('data', c => raw += c);
  res.on('end', () => {
    try {
      const data = JSON.parse(raw);
      const msgs = data.data || [];
      console.log('Total messages in session:', msgs.length);
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        console.log(`\n--- Message ${i}: id=${m.id} role=${m.role} type=${m.type} finish=${m.finish} ---`);
        if (Array.isArray(m.content)) {
          for (const part of m.content) {
            if (part.type === 'text') {
              console.log('  [TEXT]:', (part.text || '').slice(0, 200).replace(/\n/g, ' '));
            } else if (part.type === 'tool-call') {
              console.log('  [TOOL CALL]:', part.name, JSON.stringify(part.args || {}));
            } else if (part.type === 'tool-result') {
              console.log('  [TOOL RESULT]:', part.toolCallId, String(part.content || '').slice(0, 150));
            } else {
              console.log('  [PART]:', part.type, JSON.stringify(part).slice(0, 100));
            }
          }
        }
      }
    } catch (e) {
      console.error(e, raw.slice(0, 300));
    }
  });
});
req.on('error', e => console.error(e));
