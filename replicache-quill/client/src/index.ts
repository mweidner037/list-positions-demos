import {Replicache} from 'replicache';
import {mutators} from 'shared';
import {MyTodo} from './component/my-todo';
import {TodoItem} from './component/todo-item';
import {createSpace, spaceExists} from './space';
import './style.css';

window.customElements.define('my-todo', MyTodo);
window.customElements.define('todo-item', TodoItem);

async function init() {
  const {pathname} = window.location;

  if (pathname === '/' || pathname === '') {
    window.location.href = '/list/' + (await createSpace());
    return;
  }

  // URL layout is "/list/<listid>"
  const paths = pathname.split('/');
  const [, listDir, listID] = paths;
  if (
    listDir !== 'list' ||
    listID === undefined ||
    !(await spaceExists(listID))
  ) {
    window.location.href = '/';
    return;
  }

  // See https://doc.replicache.dev/licensing for how to get a license key.
  const licenseKey = import.meta.env.VITE_REPLICACHE_LICENSE_KEY;
  if (!licenseKey) {
    throw new Error('Missing VITE_REPLICACHE_LICENSE_KEY');
  }

  const r = new Replicache({
    licenseKey,
    pushURL: `/api/replicache/push?spaceID=${listID}`,
    pullURL: `/api/replicache/pull?spaceID=${listID}`,
    name: listID,
    mutators,
  });

  // Implements a Replicache poke using Server-Sent Events.
  // If a "poke" message is received, it will pull from the server.
  const ev = new EventSource(`/api/replicache/poke?spaceID=${listID}`, {
    withCredentials: true,
  });
  ev.onmessage = async event => {
    if (event.data === 'poke') {
      await r.pull();
    }
  };

  const root = document.querySelector('.todoapp');
  if (root) {
    const myTodo = new MyTodo();
    myTodo.replicache = r;
    root.appendChild(myTodo);
  }
}
await init();
