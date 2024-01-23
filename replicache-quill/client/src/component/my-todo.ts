import {M, listTodos, TodoUpdate, Todo} from 'shared';
import {nanoid} from 'nanoid';
import type {Replicache} from 'replicache';
import {assert} from '../assert.js';
import {TodoItem, TodoItemEventHandlers} from './todo-item.js';

const templateTodo = document.createElement('template');
templateTodo.innerHTML = `
<header class="header">
   <h1>Todos WC</h1>
   <input class="new-todo" type="text" placeholder="What needs to be done?">
</header>
<section class="main">
   <span><input class="toggle-all" type="checkbox"><label></label></span>
   <ul class="todo-list"></ul>
</section>
<footer class="footer">
   <span class="todo-count">
   <strong><span class="item-count"></span></strong> items left</span>
   <ul class="filters">
      <li>
         <a id="all">All</a>
      </li>
      <li>
         <a id="active">Active</a>
      </li>
      <li>
         <a id="completed">Completed</a>
      </li>
   </ul>
</footer>
`;

type Filter = 'all' | 'active' | 'completed';

export class MyTodo extends HTMLElement {
  private _listContainer: Element | null = null;
  private _newTodoInput: HTMLInputElement | null = null;
  private _itemCount: Element | null = null;
  private _filterLinks: Iterable<Element> = [];
  private _list: Todo[] = [];
  private _filteredList: Todo[] = [];
  private _filter: Filter = 'all';
  private _r: Replicache<M> | null = null;

  set replicache(r: Replicache<M>) {
    if (this._r) {
      throw new Error('replicache already set');
    }
    this._r = r;
    this._r.subscribe(listTodos, data => {
      this._list = data;
      this._list.sort((a: Todo, b: Todo) => a.sort - b.sort);
      this._filteredList = this._filteredTodos(this._filter);
      this._render();
    });
  }

  private async _createTodo(text: string) {
    assert(this._r);
    await this._r.mutate.createTodo({
      id: nanoid(),
      text,
      completed: false,
    });
  }

  private _handleUpdateTodo = async (e: CustomEvent<TodoUpdate>) => {
    assert(this._r);
    await this._r.mutate.updateTodo(e.detail);
  };

  private _handleDeleteTodos = async (e: CustomEvent<string>) => {
    assert(this._r);
    await this._r.mutate.deleteTodo(e.detail);
  };

  private _handleFilterClick = (e: Event) => {
    const target = e.target as Element;
    this._filter = asFilter(target.id);
    this._filteredList = this._filteredTodos(this._filter);
    this._render();
  };

  private _handleTodoInputKeyUp = async (e: KeyboardEvent) => {
    assert(this._newTodoInput);
    const {value} = this._newTodoInput;
    if (e.key === 'Enter' && value) {
      this._newTodoInput.value = '';
      await this._createTodo(value);
    }
  };

  private _filteredTodos(filter: Filter) {
    return this._list.filter(todo => {
      switch (filter) {
        case 'all':
          return true;
        case 'active':
          return !todo.completed;
        case 'completed':
          return todo.completed;
      }
    });
  }

  async connectedCallback() {
    this.appendChild(templateTodo.content.cloneNode(true));
    this._newTodoInput = this.querySelector('.new-todo');
    this._listContainer = this.querySelector('.todo-list');
    this._itemCount = this.querySelector('.item-count');
    this._filterLinks = this.querySelectorAll('.filters a');
    assert(this._newTodoInput);
    this._newTodoInput.addEventListener('keyup', this._handleTodoInputKeyUp);

    for (const filter of this._filterLinks) {
      filter.addEventListener('click', this._handleFilterClick);
    }
  }

  async disconnectedCallback() {
    await this._r?.close();
  }

  private _render() {
    assert(this._listContainer);
    assert(this._itemCount);
    this._itemCount.textContent = `${this._list.length}`;
    this._listContainer.textContent = '';
    for (const todo of this._filteredList) {
      const item = new TodoItem() as TodoItem & TodoItemEventHandlers;
      item.text = todo.text;
      item.completed = todo.completed;
      item.todoID = todo.id;
      item.addEventListener('onRemove', this._handleDeleteTodos);
      item.addEventListener('onToggle', this._handleUpdateTodo);

      this._listContainer.appendChild(item);
    }

    for (const filter of this._filterLinks) {
      filter.classList.toggle('selected', filter.id === this._filter);
    }
  }
}

function asFilter(id: string): Filter {
  switch (id) {
    case 'all':
    case 'active':
    case 'completed':
      return id;
    default:
      throw new Error('Unknown filter: ' + id);
  }
}
