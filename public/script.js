const vegetables = ['Potato', 'Cucumber', 'Tomato', 'Carrot']
const FORUMS = [
  {id: 'general-discussion', label: 'General Discussion', blurb: ' '},
  {id: 'math-on-level', label: 'On Level Math', blurb: 'Algebra I'},
  {id: 'math-honors', label: 'Honors Math', blurb: 'Algebra I-H'},
  {id: 'science-lane', label: 'Science', blurb: "Dr. Lane's classes"},
  {id: 'science-carron', label: 'Science', blurb: "Mr. Carron's classes"},
  {id: 'humanities-alipour', label: 'Humanities', blurb: "Mrs. Alipour's class"},
  {id: 'humanities-fox', label: 'Humanities', blurb: "Mr. Fox's class"},
  {id: 'humanities-balan', label: 'Humanities', blurb: "Ms. Balan's classes"},
  {id: 'humanities-rutherford', label: 'Humanities', blurb: "Mr. Rutherford's classes"}

];

const BACKGROUND_STORAGE_KEY = 'storedBackground';
const THEME_STORAGE_KEY = 'tadChatTheme';

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.textContent = isDark ? 'Light mode' : 'Dark mode';
    toggle.setAttribute('aria-pressed', String(isDark));
  }
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
}

applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'light');

const fromHash = location.hash.replace('#', '');
let currentForum = forumByID(fromHash) ? fromHash : FORUMS[0].id;

window.onload = function(){
  const savedBackground = localStorage.getItem(BACKGROUND_STORAGE_KEY);
  if (!savedBackground){
    return;
  }
  document.body.style.backgroundImage = `url('${savedBackground}')`;
  refreshActivity();
  
}

let activity = {};
let seen = loadSeen();

function loadSeen(){
  try {
    return JSON.parse(localStorage.getItem('seen')) || {}; 
  } catch {
    return {};
  }
}

function saveSeen(){
  localStorage.setItem('seen', JSON.stringify(seen));
}

function unreadCount(id) {
  return Math.max(0, (activity[id] || 0) - (seen[id] || 0));
}

const ADMIN_NAME = null;
const CONTRIBUTOR_NAMES = ["nathan daniel", "lawrence", "lawrence-alt"];
function isContributor(name) {
  return CONTRIBUTOR_NAMES.includes(name);
}

function makeRoleIcon(className, label, svg) {
  const span = document.createElement('span');
  span.className = className;
  span.title = label;
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', label);
  span.innerHTML = svg;
  return span;
}

function makeCrownIcon() {
  return makeRoleIcon(
    'crown',
    'owner',
    '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">' +
    '<path fill="#F5C518" stroke="#B8860B" stroke-width="1" stroke-linejoin="round" ' +
    'd="M2 8l4.5 3L12 4l5.5 7L22 8l-2 11H4L2 8z"/>' +
    '</svg>'
  );
}

function makeContributorIcon() {
  return makeRoleIcon(
    'contributor',
    'contributor',
    '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" ' +
    'stroke="#2F81F7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="16 18 22 12 16 6"/>' +
    '<polyline points="8 6 2 12 8 18"/>' +
    '</svg>'
  );
}

function randomAnonName() {
  const veg = vegetables[Math.floor(Math.random() * vegetables.length)];
  const num = String(Math.floor(Math.random() * 10000) + 1);
  return 'Anonymous' + veg + num;
}

let myName = localStorage.getItem('handle');

if (!myName){
  myName = randomAnonName();
  localStorage.setItem('handle', myName);
}

async function registerName() {
  const res = await fetch('/users', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: myName, prevName: myName}),
  });

  if (res.status === 409) {
    myName = randomAnonName();
    localStorage.setItem('handle', myName);
    return registerName();
  }
}

registerName();

const input = document.getElementById('message-input')
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter'){
    event.preventDefault()
    sendMessage()
  }
})

let composeStartedAt = null;
let composePasted = false;
let composeTabSwitches = 0;
let sessionMessageCount = 0;

input.addEventListener('input', () => {
  if (composeStartedAt === null) composeStartedAt = Date.now();
});
input.addEventListener('paste', () => {
  composePasted = true;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && composeStartedAt !== null) {
    composeTabSwitches += 1;
  }
});

function resetComposeTracking() {
  composeStartedAt = null;
  composePasted = false;
  composeTabSwitches = 0;
}

const UNKNOWN_TELEMETRY = 'Could not find value';

function collectTelemetry() {
  let timezone = UNKNOWN_TELEMETRY;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || UNKNOWN_TELEMETRY;
  } catch {
    timezone = UNKNOWN_TELEMETRY;
  }
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    screen: `${screen.width}x${screen.height}`,
    timezone,
    language: navigator.language || UNKNOWN_TELEMETRY,
    platform: navigator.platform || UNKNOWN_TELEMETRY,
    composeMs: composeStartedAt ? Date.now() - composeStartedAt : 0,
    pasted: composePasted,
    tabSwitches: composeTabSwitches,
    deviceMemory: navigator.deviceMemory || UNKNOWN_TELEMETRY,
    cpuCores: navigator.hardwareConcurrency || UNKNOWN_TELEMETRY,
    connectionType: connection ? connection.effectiveType || UNKNOWN_TELEMETRY : UNKNOWN_TELEMETRY,
    referrer: document.referrer || UNKNOWN_TELEMETRY,
    sessionMessageCount,
  };
}

async function sendMessage() {
  const input = document.getElementById('message-input')
  if (input.value.trim() === '') return;

  await fetch('/messages', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      name: myName,
      text: input.value,
      forum: currentForum,
      telemetry: collectTelemetry(),
    }),
  });
  sessionMessageCount += 1;
  input.value = '';
  resetComposeTracking();
  loadMessages();
  refreshActivity();
}

async function loadMessages({ forceScroll = false } = {}) {
  const res = await fetch('/messages?forum=' + currentForum);
  if (!res.ok) return;
  const messages = await res.json();
  const chatBox = document.getElementById('chat-box');

  const atBottom = forceScroll || chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 50;

  chatBox.innerHTML = ''
  messages.forEach((m) => {
    const div = document.createElement('div');
    const code = document.createElement('code');
    const divtext = document.createElement('span');
    code.textContent = ` ${new Date(m.time).toLocaleTimeString()}`;
    if (m.name === ADMIN_NAME) {
      divtext.appendChild(makeCrownIcon());
    } else if (isContributor(m.name)) {
      divtext.appendChild(makeContributorIcon());
    }
    divtext.appendChild(document.createTextNode(`${m.name}: ${m.text}`));
    div.appendChild(divtext)
    div.appendChild(code);
    chatBox.appendChild(div);

  });

  if (atBottom) {
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

async function updateUsername(){
  const input = document.getElementById('username-input');
  const newName = input.value.trim();

  if (newName === '') return;

  const res = await fetch('/users', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: newName, prevName: myName}),
  });

  if (!res.ok) {
    const { error } = await res.json();
    alert(error || 'Could not set that username.');
    return;
  }

  const data = await res.json();
  myName = data.name;
  localStorage.setItem('handle', myName);

  input.value = "";
  loadMessages();
}

const settingsOverlay = document.getElementById('settings-overlay');

settingsOverlay.addEventListener('click', (event) => {
  if (event.target === settingsOverlay) closeSettings();
});

function openSettings() {
  settingsOverlay.hidden = false;
  document.addEventListener('keydown', onSettingsKeydown);
}

function closeSettings() {
  settingsOverlay.hidden = true;
  document.removeEventListener('keydown', onSettingsKeydown);
}

function onSettingsKeydown(event) {
  if (event.key === 'Escape') closeSettings();
}

function typewriter(el, text, speed = 90) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = text;
    return;
  }
  el.textContent = '';
  el.classList.add('typing');
  let i = 0;
  (function tick() {
    if (i < text.length) {
      el.textContent += text.charAt(i);
      i += 1;
      setTimeout(tick, speed);
    } else {
      el.classList.remove('typing');
    }
  })();
}

const heading = document.querySelector('.chat-side h1');
if (heading) {
  typewriter(heading, heading.textContent.trim());
}

async function getUserCount() {
  const userDisplay = document.getElementById('user-count')
  const res = await fetch('/users');
  const users = await res.json();
  const count = users.length;
  if (userDisplay) {
    userDisplay.textContent = count;
  }
}

function mobile() {
  if (navigator.userAgentData?.mobile) {
    return true;
  }
  const hasTouch = window.matchMedia("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.matchMedia("(max-width: 768px)").matches;
  
  if (hasTouch && isSmallScreen) {
    return true;
  }

  const ua = navigator.userAgent || navigator.vendor || window.opera;
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

if (mobile()) {
  alert('TAD Chat works best on PC. Click close to continue.')
}

function forumByID(id){
  return FORUMS.find((f) => f.id === id);
}

function loadForumList() {
  const nav = document.getElementById('forum-list');
  nav.innerHTML = '';
  FORUMS.forEach((f) => {
    const btn = document.createElement('button');
    btn.className = 'forum-btn' + (f.id === currentForum ? ' active' : '');
    btn.dataset.forum = f.id;

    const label = document.createElement('span');
    label.className = 'forum-label';
    label.textContent = f.label;

    const blurb = document.createElement('span');
    blurb.className = 'forum-blurb-inline';
    blurb.textContent = ' ' + f.blurb;

    btn.append(label, blurb);
    btn.addEventListener('click', () => switchForum(f.id));
    
    const count = unreadCount(f.id);
    if (count > 0){
      btn.classList.add('unread');

      const badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.textContent = count > 9 ? '9+' : String(count);
      btn.appendChild(badge);
    }

    nav.appendChild(btn);
  });
  updateTitle();
 }

function switchForum(id){
  if (!forumByID(id)) return;

  currentForum = id;
  location.hash = id;
  loadForumList();
  const blurb = document.getElementById('forum-blurb');
  if (blurb) blurb.textContent = forumByID(id).blurb;
  loadMessages({ forceScroll: true });
  refreshActivity();
}

window.addEventListener('hashchange', () => {
  const id = location.hash.replace('#', '');
  if (forumByID(id) && id !== currentForum) {
    switchForum(id);
  }
});

async function refreshActivity() {
  const res = await fetch('activity');
  if (!res.ok) return;
  activity = await res.json();
  seen[currentForum] = activity[currentForum] || 0;
  saveSeen();
  loadForumList();
}

function updateTitle() {
  const total = FORUMS.reduce((sum, f) => sum + unreadCount(f.id), 0);
  document.title = (total > 0 ? '(' + total +') ' : '') + 'TAD Chat';
}

function setBackgroundImage(){
  const backgroundInput = document.getElementById("background-image");
  const selectedBackground = backgroundInput.files[0];
  if (!selectedBackground) return;

  const reader = new FileReader();
  reader.onload = () => {
    const dataURL = reader.result;
    document.body.style.backgroundImage = `url('${dataURL}')`;
    try {
      localStorage.setItem(BACKGROUND_STORAGE_KEY, dataURL);
    } catch (err) {
      console.error('Could not save background image.', err);
      alert('That image is too large to save, so it will reset on refresh.');
    }
  };
  reader.onerror = () => {
    console.error('Could not read the selected image.', reader.error);
    alert('Could not read that image file.');
  };
  reader.readAsDataURL(selectedBackground);
}

// Intervals
setInterval(getUserCount, 30000);
getUserCount();
loadForumList();
switchForum(currentForum);
setInterval(loadMessages, 3000);
loadMessages();
setInterval(refreshActivity, 3000);