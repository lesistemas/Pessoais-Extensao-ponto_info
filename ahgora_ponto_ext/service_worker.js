const AHGORA_URL = 'https://www.ahgora.com.br/novabatidaonline/';

const DEFAULTS = {
  enabled: false,
  times: ["09:00","12:00","13:00","18:00"],
  days: [false,true,true,true,true,true,false],
  toleranceMin: 3,
  verifyAfterMin: 5,

  // ✅ Login (opcional)
  autoLogin: false,
  matricula: "",
  senha: ""
};

function now(){ return Date.now(); }

function parseTimeToMinutes(hhmm){
  const [h,m] = (hhmm||'').split(':').map(x=>parseInt(x,10));
  if(Number.isFinite(h) && Number.isFinite(m)) return h*60+m;
  return null;
}

function getRandomOffsetMs(toleranceMin){
  const maxMs = Math.max(0, toleranceMin) * 60 * 1000;
  if(maxMs <= 0) return 0;
  return Math.floor(Math.random() * (maxMs + 1));
}

async function getSettings(){
  const { settings } = await chrome.storage.sync.get('settings');
  return Object.assign({}, DEFAULTS, settings || {});
}

async function setRuntimeState(state){
  await chrome.storage.local.set({ runtimeState: state });
}

async function getRuntimeState(){
  const { runtimeState } = await chrome.storage.local.get('runtimeState');
  return runtimeState || {};
}

function nextOccurrenceTimestamp({days, hhmm, toleranceMin}, fromTs){
  const mins = parseTimeToMinutes(hhmm);
  if(mins == null) return null;

  const from = new Date(fromTs);

  for(let addDays=0; addDays<14; addDays++){
    const d = new Date(from);
    d.setDate(from.getDate() + addDays);

    const dow = d.getDay(); // 0=Sun
    if(!days[dow]) continue;

    const base = new Date(d);
    base.setHours(0,0,0,0);
    base.setMinutes(mins);

    if(base.getTime() <= fromTs) continue;

    const when = base.getTime() + getRandomOffsetMs(toleranceMin);
    if(when <= fromTs) continue;

    return { when, base: base.getTime() };
  }
  return null;
}

async function rescheduleAll(){
  const s = await getSettings();

  const alarms = await chrome.alarms.getAll();
  for(const a of alarms){
    await chrome.alarms.clear(a.name);
  }

  if(!s.enabled){
    await setRuntimeState({});
    return;
  }

  const fromTs = now();
  let best = null;
  let bestName = null;

  for(const t of s.times){
    const occ = nextOccurrenceTimestamp({days:s.days, hhmm:t, toleranceMin:s.toleranceMin}, fromTs);
    if(!occ) continue;
    if(!best || occ.when < best.when){
      best = { ...occ, hhmm: t };
      bestName = `PONTO:${t}`;
    }
  }

  if(!best){
    await setRuntimeState({});
    return;
  }

  await chrome.alarms.create(bestName, { when: best.when });
  await setRuntimeState({
    nextAlarmName: bestName,
    nextWhen: best.when,
    nextBase: best.base,
    nextHhmm: best.hhmm
  });
}

async function openOrFocusAhgora(){
  const tabs = await chrome.tabs.query({ url: 'https://www.ahgora.com.br/novabatidaonline/*' });
  if(tabs && tabs.length){
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if(tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    return tab;
  }
  return await chrome.tabs.create({ url: AHGORA_URL, active: true });
}

async function sendToTab(tabId, msg){
  try{
    return await chrome.tabs.sendMessage(tabId, msg);
  }catch{
    return null;
  }
}

function notify(title, message, buttons){
  return chrome.notifications.create({
    type: 'basic',
    iconUrl: 'assets/icon128.png',
    title,
    message,
    buttons: buttons || [],
    priority: 2
  });
}

async function waitTabComplete(tabId, timeoutMs = 15000){
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    let t;
    try { t = await chrome.tabs.get(tabId); } catch { t = null; }
    if(t?.status === 'complete') return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function ensureContentReady(tabId){
  for(let i=0;i<20;i++){
    const pong = await sendToTab(tabId, { type: 'PING' });
    if(pong?.ok) return true;
    await new Promise(r => setTimeout(r, 300));
  }

  try{
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  }catch{}

  for(let i=0;i<10;i++){
    const pong = await sendToTab(tabId, { type: 'PING' });
    if(pong?.ok) return true;
    await new Promise(r => setTimeout(r, 300));
  }

  return false;
}

async function handleAlarm(name){
  if(!name.startsWith('PONTO:')) return;

  const s = await getSettings();
  if(!s.enabled) return;

  const tab = await openOrFocusAhgora();

  let baseline = null;
  if(tab?.id != null){
    await waitTabComplete(tab.id, 20000);
    const ready = await ensureContentReady(tab.id);

    if(ready){
      baseline = await sendToTab(tab.id, { type: 'COUNT_REGISTROS' });

      // ✅ Se tiver login configurado, faz login + registra
      if(s.autoLogin && (s.matricula || '').trim() && (s.senha || '').trim()){
        await sendToTab(tab.id, {
          type: 'AUTO_LOGIN_AND_REGISTER',
          payload: { matricula: s.matricula, senha: s.senha }
        });
      }else{
        // senão, só tenta clicar no botão (se já estiver logado)
        await sendToTab(tab.id, { type: 'HIGHLIGHT_BOTAO' });
      }
    }else{
      await notify('Ahgora Ponto', 'Abri o Ahgora, mas não consegui conectar no conteúdo da página (content script).', []);
    }
  }

  const notifId = await notify(
    'Hora de registrar o ponto',
    `Abra a aba do Ahgora e clique em “Registre seu ponto”. Vou checar em ${s.verifyAfterMin} min se apareceu um novo registro.`,
    [
      { title: 'Abrir Ahgora' },
      { title: 'Já registrei' }
    ]
  );

  const verifyName = `VERIFY:${Date.now()}`;
  const verifyWhen = now() + (Math.max(1, s.verifyAfterMin) * 60 * 1000);

  await chrome.storage.local.set({
    lastNotifId: notifId,
    lastAlarmName: name,
    verifyPlan: {
      verifyName,
      verifyWhen,
      tabId: tab?.id ?? null,
      baselineCount: baseline?.count ?? null,
      baselineText: baseline?.sample ?? null,
      hhmm: name.replace('PONTO:',''),
      createdAt: now()
    }
  });

  await chrome.alarms.create(verifyName, { when: verifyWhen });

  await rescheduleAll();
}

async function handleVerify(alarmName){
  if(!alarmName.startsWith('VERIFY:')) return;
  const { verifyPlan } = await chrome.storage.local.get('verifyPlan');
  if(!verifyPlan || verifyPlan.verifyName !== alarmName) return;

  let tab = null;
  if(verifyPlan.tabId != null){
    try{ tab = await chrome.tabs.get(verifyPlan.tabId); }catch{}
  }
  if(!tab){
    const tabs = await chrome.tabs.query({ url: 'https://www.ahgora.com.br/novabatidaonline/*' });
    tab = tabs?.[0] || null;
  }

  if(!tab?.id){
    await notify('Checagem do ponto', 'Não achei a aba do Ahgora para verificar. Se você já registrou, ignore.', []);
    return;
  }

  await waitTabComplete(tab.id, 20000);
  const ready = await ensureContentReady(tab.id);
  if(!ready){
    await notify('Checagem inconclusiva', 'A aba abriu, mas não consegui conectar no conteúdo da página para contar os registros.', [
      { title: 'Abrir Ahgora' }
    ]);
    await chrome.storage.local.remove('verifyPlan');
    return;
  }

  const current = await sendToTab(tab.id, { type: 'COUNT_REGISTROS' });

  const before = verifyPlan.baselineCount;
  const after = current?.count ?? null;

  if(before != null && after != null){
    if(after > before){
      await notify('Ponto detectado ✅', 'Vi um novo “Registro realizado” na tela. Tudo certo.', []);
    }else{
      await notify('Não detectei novo registro ⚠️', 'Não vi aumento nos “Registros do dia”. Confira se você clicou em “Registre seu ponto”.', [
        { title: 'Abrir Ahgora' }
      ]);
    }
  }else{
    if(after != null && after > 0){
      await notify('Checagem concluída', `Encontrei ${after} registro(s) na tela. Se o último foi o seu, tudo certo.`, []);
    }else{
      await notify('Checagem inconclusiva', 'Não consegui ler os registros na tela. Pode ser que o layout tenha mudado.', [
        { title: 'Abrir Ahgora' }
      ]);
    }
  }

  await chrome.storage.local.remove('verifyPlan');
}

chrome.alarms.onAlarm.addListener(async (alarm)=>{
  try{
    if(alarm.name.startsWith('PONTO:')) return await handleAlarm(alarm.name);
    if(alarm.name.startsWith('VERIFY:')) return await handleVerify(alarm.name);
  }catch(e){
    await notify('Ahgora Ponto – erro', String(e?.message || e), []);
  }
});

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx)=>{
  const { lastNotifId } = await chrome.storage.local.get('lastNotifId');
  if(lastNotifId !== notifId) return;

  if(btnIdx === 0){
    await openOrFocusAhgora();
  }
  if(btnIdx === 1){
    await notify('Confirmado', 'Ok! Vou só fazer a checagem automática no horário combinado.', []);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try{
      if(msg?.type === 'RESCHEDULE'){
        await rescheduleAll();
        sendResponse({ ok:true });
        return;
      }
      if(msg?.type === 'OPEN_AHGORA'){
        await openOrFocusAhgora();
        sendResponse({ ok:true });
        return;
      }
      if(msg?.type === 'TEST_NOTIFICATION'){
        await notify('Teste de alerta', 'Se você está vendo isso, as notificações estão ok.', []);
        sendResponse({ ok:true });
        return;
      }
      if(msg?.type === 'GET_NEXT'){
        const st = await getRuntimeState();
        sendResponse({ ok:true, state: st });
        return;
      }

      sendResponse({ ok:false, reason:'unknown_type', type: msg?.type });
    }catch(e){
      console.error('[AhgoraExt][sw] onMessage error:', e);
      sendResponse({ ok:false, error: String(e?.message || e) });
    }
  })();

  return true;
});

chrome.runtime.onInstalled.addListener(async ()=>{
  const { settings } = await chrome.storage.sync.get('settings');
  if(!settings){
    await chrome.storage.sync.set({ settings: DEFAULTS });
  }
  await rescheduleAll();
});

chrome.runtime.onStartup.addListener(async ()=>{
  await rescheduleAll();
});
