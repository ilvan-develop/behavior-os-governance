// validation-lab/harness/test-opencode-client.mjs
const serverUrl = 'http://127.0.0.1:4096';
const pw = 'WIUoALbabiovJiW3SvE10pZnv947oigFuz0MUZ5N4SA';
const authHeader = 'Basic ' + Buffer.from('opencode:' + pw).toString('base64');

async function main() {
  console.log('1. Creating session...');
  const sessRes = await fetch(`${serverUrl}/api/session`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  const sessData = await sessRes.json();
  const sessionId = sessData.data.id;
  console.log('Created session:', sessionId);

  console.log('2. Setting model to opencode/deepseek-v4.1-flash-free...');
  const modelRes = await fetch(`${serverUrl}/api/session/${sessionId}/model`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: {
        providerID: 'opencode',
        id: 'deepseek-v4.1-flash-free'
      }
    })
  });
  console.log('Switch model status:', modelRes.status);
  if (modelRes.status !== 204 && modelRes.status !== 200) {
    console.log('Model switch error:', await modelRes.text());
  }

  console.log('3. Sending test prompt...');
  const promptRes = await fetch(`${serverUrl}/api/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: 'Respond with exactly one word: READY'
    })
  });
  console.log('Prompt status:', promptRes.status);

  console.log('4. Polling for assistant message...');
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const msgRes = await fetch(`${serverUrl}/api/session/${sessionId}/message`, {
      headers: { Authorization: authHeader }
    });
    const messages = await msgRes.json();
    console.log(`Poll ${i + 1}: ${messages.data?.length ?? 0} messages`);
    const assistantMsg = messages.data?.find(m => m.type === 'assistant');
    if (assistantMsg) {
      console.log('Assistant message status:', assistantMsg.finish);
      console.log('Assistant content:', JSON.stringify(assistantMsg.content, null, 2));
      if (assistantMsg.error) {
        console.log('Assistant error:', JSON.stringify(assistantMsg.error, null, 2));
      }
      break;
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
