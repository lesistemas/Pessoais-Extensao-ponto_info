const DEFAULTS = {
  enabled: false,
  times: ["09:00","12:00","13:00","18:00"],
  days: [false,true,true,true,true,true,false], // 0=Dom ... 6=Sáb (seg-sex true)
  toleranceMin: 3,
  verifyAfterMin: 5,
  autoLogin: false,
  matricula: "",
  senha: ""
};

const el = (id) => document.getElementById(id);

function dayLabel(idx){
  return ["D","S","T","Q","Q","S","S"][idx];
}

function renderDays(days){
  const wrap = el('days');
  wrap.innerHTML = '';
  for(let i=0;i<7;i++){
    const d = document.createElement('label');
    d.className = 'day' + (days[i] ? ' on' : '');
    d.innerHTML = `<input type="checkbox" data-day="${i}" ${days[i]?'checked':''}/><span>${dayLabel(i)}</span>`;
    d.addEventListener('click', (ev)=>{
      ev.preventDefault();
      days[i] = !days[i];
      renderDays(days);
    });
    wrap.appendChild(d);
  }
}

function renderTimes(times){
  const wrap = el('times');
  wrap.innerHTML = '';
  times.forEach((t, idx)=>{
    const row = document.createElement('div');
    row.className = 'timeRow';
    row.innerHTML = `
      <input type="time" value="${t}" data-idx="${idx}" />
      <button data-remove="${idx}">Remover</button>
    `;
    row.querySelector('input').addEventListener('change', (e)=>{
      times[idx] = e.target.value;
    });
    row.querySelector('button').addEventListener('click', ()=>{
      times.splice(idx,1);
      renderTimes(times);
    });
    wrap.appendChild(row);
  });
}

async function load(){
  const { settings } = await chrome.storage.sync.get('settings');
  const s = Object.assign({}, DEFAULTS, settings || {});

  el('enabled').checked = !!s.enabled;
  el('toleranceMin').value = s.toleranceMin;
  el('verifyAfterMin').value = s.verifyAfterMin;

  // Login (opcional)
  el('autoLogin').checked = !!s.autoLogin;
  el('matricula').value = s.matricula || '';
  el('senha').value = s.senha || '';

  // keep references
  window.__times = Array.isArray(s.times) ? [...s.times] : [...DEFAULTS.times];
  window.__days = Array.isArray(s.days) && s.days.length===7 ? [...s.days] : [...DEFAULTS.days];

  renderTimes(window.__times);
  renderDays(window.__days);
}

async function save(){
  const status = el('status');
  const enabled = el('enabled').checked;
  const toleranceMin = Math.max(0, Math.min(10, parseInt(el('toleranceMin').value || '0',10)));
  const verifyAfterMin = Math.max(1, Math.min(30, parseInt(el('verifyAfterMin').value || '5',10)));

  const autoLogin = el('autoLogin').checked;
  const matricula = (el('matricula').value || '').trim();
  const senha = (el('senha').value || '').trim();

  const times = (window.__times || [])
    .map(x => (x||'').trim())
    .filter(Boolean);

  // basic validation
  const uniq = [...new Set(times)];
  if(uniq.length === 0){
    status.textContent = 'Adicione pelo menos 1 horário.';
    return;
  }

  const days = window.__days || DEFAULTS.days;
  if(!days.some(Boolean)){
    status.textContent = 'Selecione pelo menos 1 dia da semana.';
    return;
  }

  const settings = { enabled, times: uniq, days, toleranceMin, verifyAfterMin, autoLogin, matricula, senha };
  await chrome.storage.sync.set({ settings });

  // ask SW to reschedule
  await chrome.runtime.sendMessage({ type: 'RESCHEDULE' });
  status.textContent = 'Salvo! Agendamentos atualizados.';
  setTimeout(()=> status.textContent = '', 2000);
}

function wire(){
  el('addTime').addEventListener('click', ()=>{
    window.__times.push('09:00');
    renderTimes(window.__times);
  });

  el('weekdays').addEventListener('click', ()=>{
    window.__days = [false,true,true,true,true,true,false];
    renderDays(window.__days);
  });
  el('alldays').addEventListener('click', ()=>{
    window.__days = [true,true,true,true,true,true,true];
    renderDays(window.__days);
  });
  el('cleardays').addEventListener('click', ()=>{
    window.__days = [false,false,false,false,false,false,false];
    renderDays(window.__days);
  });

  el('openNow').addEventListener('click', async ()=>{
    await chrome.runtime.sendMessage({ type: 'OPEN_AHGORA' });
    el('status').textContent = 'Abrindo Ahgora...';
    setTimeout(()=> el('status').textContent = '', 1500);
  });

  el('testNotif').addEventListener('click', async ()=>{
    await chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' });
  });

  el('save').addEventListener('click', save);
}

document.addEventListener('DOMContentLoaded', async ()=>{
  wire();
  await load();
});
