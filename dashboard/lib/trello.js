// Thin Trello REST client (server-side, so the key/token never reach the browser).
const { config } = require('./env');

function url(p) {
  const { key, token } = config.trello;
  return 'https://api.trello.com/1/' + p + (p.includes('?') ? '&' : '?') + 'key=' + key + '&token=' + token;
}

async function call(method, p, expectJson = true) {
  const res = await fetch(url(p), { method });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Trello ' + method + ' ' + p.split('?')[0] + ' → ' + res.status + ' ' + body.slice(0, 200));
  }
  return expectJson ? res.json() : res.text();
}

const get = (p) => call('GET', p).catch(() => []);
const post = (p) => call('POST', p);
const put = (p) => call('PUT', p);
const del = (p) => call('DELETE', p).catch(() => null);

// Cards of a list with the fields the dashboard needs.
const listCards = (listId) => get('lists/' + listId + '/cards?fields=name,desc,dateLastActivity,idLabels');

// Comment actions on a card (newest first as returned by Trello).
const cardComments = (cardId, limit = 30) =>
  get('cards/' + cardId + '/actions?filter=commentCard&limit=' + limit);

const addComment = (cardId, text) =>
  post('cards/' + cardId + '/actions/comments?text=' + encodeURIComponent(text));

const createCard = (listId, name, desc) =>
  post('cards?idList=' + listId + '&name=' + encodeURIComponent(name) + '&desc=' + encodeURIComponent(desc));

const moveCard = (cardId, listId) => put('cards/' + cardId + '?idList=' + listId);
const deleteCard = (cardId) => del('cards/' + cardId);

// Parse the footer the workflows store in each card description.
function parseMeta(desc) {
  const d = String(desc || '');
  const g = (re) => {
    const m = d.match(re);
    return m ? m[1].trim() : '';
  };
  const normRepo = (u) =>
    String(u || '')
      .trim()
      .replace(/\.git$/, '')
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/^github\.com\//i, '');
  return { repo: normRepo(g(/repo:\s*(\S+)/)), project: g(/project:\s*(.+)/), ref: g(/ref:\s*(\S+)/), clone: g(/clone:\s*(\S+)/) };
}

function trackOf(name) {
  const m = String(name || '').match(/^\[(backend|frontend|mobile)\]/);
  return m ? m[1] : 'backend';
}

function complexityOf(name) {
  const m = String(name || '').match(/^\[[a-z]+\]\[(boilerplate|medium|complex)\]/);
  return m ? m[1] : '';
}

async function getCardDetail(cardId) {
  const [card, comments] = await Promise.all([
    call('GET', 'cards/' + cardId + '?fields=name,desc,dateLastActivity,url,idList,labels'),
    cardComments(cardId, 50),
  ]);
  return {
    id: card.id,
    name: card.name,
    desc: card.desc || '',
    url: card.url,
    updated: card.dateLastActivity,
    labels: (card.labels || []).map((l) => l.name || l.color),
    comments: (comments || []).map((a) => ({
      author: a.memberCreator && a.memberCreator.fullName,
      text: a.data && a.data.text,
      ts: a.date,
    })),
  };
}

module.exports = {
  get,
  post,
  put,
  del,
  listCards,
  cardComments,
  addComment,
  createCard,
  moveCard,
  deleteCard,
  parseMeta,
  trackOf,
  complexityOf,
  getCardDetail,
};
