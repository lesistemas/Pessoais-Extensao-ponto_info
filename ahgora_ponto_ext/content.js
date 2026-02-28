function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function norm(s){
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/\s+/g,' ')
    .trim();
}

function ensureHighlightStyle(){
  if(document.getElementById('ahgoraPontoStyle')) return;
  const s = document.createElement('style');
  s.id = 'ahgoraPontoStyle';
  s.textContent = `
    .ahgora-ponto-highlight{
      outline: 3px solid rgba(79,170,255,.95) !important;
      box-shadow: 0 0 0 6px rgba(79,170,255,.18) !important;
      border-radius: 10px !important;
      position: relative;
      z-index: 999999 !important;
    }
    .ahgora-ponto-toast{
      position: fixed;
      left: 16px;
      bottom: 16px;
      background: rgba(18,18,18,.95);
      color: #f2f2f2;
      border: 1px solid rgba(79,170,255,.35);
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
      border-radius: 14px;
      padding: 12px 14px;
      max-width: 340px;
      font: 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Arial;
      z-index: 999999;
    }
    .ahgora-ponto-toast .small{opacity:.8;font-size:12px;margin-top:4px;}
  `;
  document.documentElement.appendChild(s);
}

function showToast(msg){
  ensureHighlightStyle();
  const old = document.getElementById('ahgoraPontoToast');
  if(old) old.remove();
  const d = document.createElement('div');
  d.id = 'ahgoraPontoToast';
  d.className = 'ahgora-ponto-toast';
  d.innerHTML = `<div>${msg}</div><div class="small">Ahgora Ponto – extensão</div>`;
  document.body.appendChild(d);
  setTimeout(()=> d.remove(), 9000);
}

function findButtonByTextContains(text){
  const t = norm(text);
  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.find(b => norm(b.innerText || b.textContent).includes(t)) || null;
}

function findRegistreButton(){
  // o texto pode variar (maiúsculas, espaços, etc.)
  const btn = findButtonByTextContains('registre seu ponto');
  if(btn) return btn;

  // fallback: aria-label/title
  const candidates = Array.from(document.querySelectorAll('button'));
  return candidates.find(b =>
    norm(b.getAttribute('aria-label')).includes('registre seu ponto') ||
    norm(b.title).includes('registre seu ponto')
  ) || null;
}

function findAvancarButton(){
  // Na sua página, o texto "Avançar" está dentro de um <p> dentro do botão
  let btn = findButtonByTextContains('avançar');
  if(btn) return btn;

  // fallback: procura <p> com "Avançar" e sobe pro botão
  const ps = Array.from(document.querySelectorAll('p'));
  const p = ps.find(x => norm(x.textContent).includes('avancar'));
  if(p){
    const b = p.closest('button');
    if(b) return b;
  }
  return null;
}

function isVisible(el){
  if(!el) return false;
  const style = window.getComputedStyle(el);
  if(style.visibility === 'hidden' || style.display === 'none') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findRegistrarPontoButton(){
  // Busca botão que contenha o texto "Registrar ponto" (Material UI coloca <p> dentro do button)
  const buttons = Array.from(document.querySelectorAll('button'));
  const matches = buttons.filter(b => isVisible(b) && norm(b.innerText).includes('registrar ponto'));
  if(matches.length === 0) return null;
  // Preferir o que tem SVG (ícone de check) e o texto
  const withSvg = matches.find(b => b.querySelector('svg'));
  return withSvg || matches[0];
}

async function waitForRegistrarPontoAndClick(timeoutMs = 12000){
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    const btn = findRegistrarPontoButton();
    if(btn){
      btn.scrollIntoView({ behavior:'smooth', block:'center', inline:'center' });
      await sleep(150);
      btn.classList.add('ahgora-ponto-highlight');
      alert("clique");
      try{ btn.click(); }catch{}
      setTimeout(()=> btn.classList.remove('ahgora-ponto-highlight'), 8000);
      return { ok:true };
    }
    await sleep(250);
  }
  return { ok:false, reason:'registrar_ponto_not_found' };
}

function setNativeValue(el, value){
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if(desc?.set) desc.set.call(el, value);
  else el.value = value;

  el.dispatchEvent(new Event('input', { bubbles:true }));
  el.dispatchEvent(new Event('change', { bubbles:true }));
}

function fillLogin(matricula, senha){
  // ids vistos no seu HTML:
  // #outlined-basic-account, #outlined-basic-password
  const acc = document.querySelector('#outlined-basic-account');
  const pass = document.querySelector('#outlined-basic-password');
  if(!acc || !pass){
    return { ok:false, reason:'inputs_not_found' };
  }
  setNativeValue(acc, matricula ?? '');
  setNativeValue(pass, senha ?? '');
  return { ok:true };
}

async function getCredsFromStorage(){
  try{
    const { settings } = await chrome.storage.sync.get('settings');
    const s = settings || {};
    return {
      matricula: (s.matricula || '').trim(),
      senha: (s.senha || '').trim(),
      autoLogin: !!s.autoLogin
    };
  }catch{
    return { matricula:'', senha:'', autoLogin:false };
  }
}

function findModalRootFromInput(inputEl){
  let cur = inputEl;
  for(let i=0;i<12 && cur; i++){
    const container = cur.closest('div');
    if(!container) break;
    // tenta achar um botão Avançar dentro desse container
    const btn = Array.from(container.querySelectorAll('button'))
      .find(b => norm(b.innerText || b.textContent).includes('avancar'));
    if(btn) return container;
    cur = container.parentElement;
  }
  return document.body;
}

function findAvancarButtonScoped(root){
  if(!root) return findAvancarButton();
  const btns = Array.from(root.querySelectorAll('button'));
  let btn = btns.find(b => norm(b.innerText || b.textContent).includes('avancar')) || null;
  if(btn) return btn;

  const ps = Array.from(root.querySelectorAll('p'));
  const p = ps.find(x => norm(x.textContent).includes('avancar'));
  if(p){
    const b = p.closest('button');
    if(b) return b;
  }
  return null;
}

async function waitForRegisterPopupAndSubmit({ matricula, senha }, timeoutMs = 12000){
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    const acc = document.querySelector('#outlined-basic-account');
    const pass = document.querySelector('#outlined-basic-password');
    if(acc && pass){
      if(!(matricula||'').trim() || !(senha||'').trim()){
        showToast('Popup de identificação apareceu, mas não tem Matrícula/Senha salvos na extensão. Abra o popup da extensão e salve.');
        return { ok:false, reason:'missing_creds' };
      }

      // Preenche
      setNativeValue(acc, matricula);
      setNativeValue(pass, senha);

      // Clica Avançar (de preferência dentro do popup)
      const root = findModalRootFromInput(acc);
      const avancar = findAvancarButtonScoped(root);
      if(!avancar){
        showToast('Preenchi o popup, mas não encontrei o botão "Avançar" nele.');
        return { ok:false, reason:'popup_avancar_not_found' };
      }

      avancar.scrollIntoView({ behavior:'smooth', block:'center', inline:'center' });
      await sleep(150);
      avancar.classList.add('ahgora-ponto-highlight');
      try{ avancar.click(); }catch{}
      setTimeout(()=> avancar.classList.remove('ahgora-ponto-highlight'), 8000);

      // Após avançar, esperar o botão 'Registrar ponto' e clicar
      const reg = await waitForRegistrarPontoAndClick(15000);
      if(!reg.ok){
        showToast('Avancei no popup, mas não encontrei o botão "Registrar ponto" para confirmar.');
        return { ok:false, reason: reg.reason };
      }

      showToast('Popup detectado: preenchi Matrícula/Senha, avancei e confirmei o registro ✅');
      return { ok:true };
    }
    await sleep(250);
  }
  return { ok:false, reason:'popup_not_found' };
}

async function highlightAndClickRegistre(creds){
  ensureHighlightStyle();
  const btn = findRegistreButton();
  if(!btn){
    showToast('Não encontrei "Registre seu ponto" ainda...');
    return { ok:false, reason:'not_found' };
  }

  btn.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  await sleep(250);
  await new Promise(r => requestAnimationFrame(r));

  btn.classList.add('ahgora-ponto-highlight');

  try{
    btn.click();
  }catch{
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, view:window }));
    btn.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true, view:window }));
    btn.dispatchEvent(new MouseEvent('click',     { bubbles:true, cancelable:true, view:window }));
  }

  showToast('Cliquei em "Registre seu ponto" ✅');
  setTimeout(()=> btn.classList.remove('ahgora-ponto-highlight'), 15000);

  // ✅ Nova versão: após clicar, pode abrir um popup pedindo matrícula/senha
  // Se não vier credencial no payload, tenta pegar do storage da extensão
  const c = (creds?.matricula || creds?.senha) ? {
    matricula: creds?.matricula || '',
    senha: creds?.senha || ''
  } : await getCredsFromStorage();

  // tenta por alguns segundos. Se não aparecer popup, tudo bem.
  await waitForRegisterPopupAndSubmit(c, 10000);
  return { ok:true };
}

async function waitForRegistreButton(timeoutMs = 20000){
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    const btn = findRegistreButton();
    if(btn) return true;
    await sleep(400);
  }
  return false;
}

async function autoLoginAndRegister({ matricula, senha }){
  ensureHighlightStyle();

  // Se já estiver logado, o botão de registrar pode existir direto
  if(findRegistreButton()){
    return await highlightAndClickRegistre({ matricula, senha });
  }

  // Preenche login
  const filled = fillLogin(matricula, senha);
  if(!filled.ok){
    showToast('Não achei os campos de Matrícula/Senha nessa tela.');
    return filled;
  }

  // Clica em Avançar
  const avancar = findAvancarButton();
  if(!avancar){
    showToast('Não encontrei o botão "Avançar".');
    return { ok:false, reason:'avancar_not_found' };
  }

  avancar.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  await sleep(200);
  avancar.classList.add('ahgora-ponto-highlight');

  try{ avancar.click(); } catch {}
  showToast('Preenchi e cliquei em "Avançar"...');

  // Espera o botão "Registre seu ponto" aparecer
  const ok = await waitForRegistreButton(25000);
  if(!ok){
    showToast('Entrei, mas não apareceu "Registre seu ponto" (talvez login falhou ou a página mudou).');
    return { ok:false, reason:'registre_timeout' };
  }

  return await highlightAndClickRegistre({ matricula, senha });
}

function countRegistros(){
  const ps = Array.from(document.querySelectorAll('p'));
  const hits = ps.filter(p => norm(p.textContent) === 'registro realizado');

  let sample = null;
  if(hits[0]){
    const container = hits[0].parentElement;
    if(container){
      const sibPs = Array.from(container.querySelectorAll('p'))
        .map(x => (x.textContent||'').trim())
        .filter(Boolean);
      sample = sibPs.join(' | ');
    }
  }
  return { count: hits.length, sample };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'PING') {
        sendResponse({ ok:true });
        return;
      }

      if (msg?.type === 'AUTO_LOGIN_AND_REGISTER') {
        const r = await autoLoginAndRegister(msg?.payload || {});
        sendResponse(r ?? { ok:false, reason:'no_result' });
        return;
      }

      if (msg?.type === 'HIGHLIGHT_BOTAO') {
        // pode vir sem payload; nesse caso o script tenta pegar as credenciais do storage
        const r = await highlightAndClickRegistre(msg?.payload);
        sendResponse(r ?? { ok:false, reason:'no_result' });
        return;
      }

      if (msg?.type === 'COUNT_REGISTROS') {
        await sleep(250);
        sendResponse(countRegistros());
        return;
      }

      sendResponse({ ok:false, reason:'unknown_type', type: msg?.type });
    } catch (e) {
      console.error('[AhgoraExt][content] onMessage error:', e);
      sendResponse({ ok:false, error: String(e?.message || e) });
    }
  })();

  return true;
});
