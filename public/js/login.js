const $ = id => document.getElementById(id);
const HOME = { Admin: 'admin.html', Conductor: 'conductor.html', Cliente: 'cliente.html', Soporte: 'soporte.html' };
const msg = t => { $('msg').textContent = t || ''; $('msg').classList.toggle('show', !!t); };
function tab(reg) { $('fL').hidden = reg; $('fR').hidden = !reg; $('tL').classList.toggle('on', !reg); $('tR').classList.toggle('on', reg); msg(); }
$('tL').onclick = () => tab(false); $('tR').onclick = () => tab(true);
document.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { const i = $(b.dataset.ver); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Mostrar' : 'Ocultar'; });

async function enviar(url, payload, btn) {
  btn.disabled = true; msg();
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.mensaje || 'No fue posible completar la solicitud');
    if (!HOME[d.rol]) throw new Error('Rol no reconocido: ' + d.rol);
    sessionStorage.setItem('ht_token', d.token);
    sessionStorage.setItem('ht_user', JSON.stringify({ id: d.id_usuario, nombre: d.nombre, rol: d.rol }));
    location.assign(HOME[d.rol]);
  } catch (e) { msg(e.message === 'Failed to fetch' ? 'Error de conexión con el servidor' : e.message); btn.disabled = false; }
}
$('fL').onsubmit = e => { e.preventDefault(); enviar('/api/login', { correo: $('lc').value, contrasena: $('lp').value }, $('bL')); };

const okMail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
$('rc').onblur = async () => {
  const v = $('rc').value.trim(), h = $('hc');
  if (!v) { h.textContent = ''; return; }
  if (!okMail(v)) { h.textContent = 'Correo no válido'; h.className = 'hint bad'; return; }
  try {
    const d = await (await fetch('/api/email-disponible?correo=' + encodeURIComponent(v))).json();
    h.textContent = d.disponible ? 'Correo disponible' : 'Este correo ya tiene una cuenta'; h.className = 'hint ' + (d.disponible ? 'ok' : 'bad');
  } catch { h.textContent = ''; }
};
const fuerza = p => [p.length >= 8, /[a-z]/.test(p) && /[A-Z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length;
function chk() { const h = $('hp'); if (!$('rp2').value) { h.textContent = ''; return; } const ok = $('rp').value === $('rp2').value; h.textContent = ok ? 'Las contraseñas coinciden' : 'Las contraseñas no coinciden'; h.className = 'hint ' + (ok ? 'ok' : 'bad'); }
$('rp').oninput = () => { const f = fuerza($('rp').value); $('mt').style.width = f * 25 + '%'; $('mt').style.background = ['#c53030', '#c53030', '#b7791f', '#2f9e6e', '#12805c'][f]; chk(); };
$('rp2').oninput = chk;
$('fR').onsubmit = e => {
  e.preventDefault();
  const p = $('rp').value;
  if ($('rn').value.trim().length < 3) return msg('Ingresa tu nombre completo');
  if (!okMail($('rc').value.trim())) return msg('Correo electrónico no válido');
  if (p.length < 8 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) return msg('La contraseña debe tener mínimo 8 caracteres, con letras y números');
  if (p !== $('rp2').value) return msg('Las contraseñas no coinciden');
  enviar('/api/register', { nombre: $('rn').value, documento: $('rd').value, telefono: $('rt').value, direccion: $('rdir').value, correo: $('rc').value, contrasena: p }, $('bR'));
};
try { const u = JSON.parse(sessionStorage.getItem('ht_user')); if (sessionStorage.getItem('ht_token') && HOME[u.rol]) location.replace(HOME[u.rol]); } catch {}
