import type {TodoUpdate} from 'shared';
import {assert} from '../assert';

const templateTodoItem = document.createElement('template');
templateTodoItem.innerHTML = `
<li class="item">
   <div class="view">
      <input class="toggle" type="checkbox">
      <label></label>
      <button class="destroy"></button>
   </div>
</li>
`;

export interface TodoItemEventHandlers {
  // This is not really correct but good enough for now.
  addEventListener<T>(
    type: string,
    listener: (e: CustomEvent<T>) => void,
  ): void;
}

export class TodoItem extends HTMLElement {
  static observedAttributes = ['text', 'completed'];

  private _todoID = '';
  private _item: Element | null = null;
  private _textElement: HTMLLabelElement | null = null;
  private _checkbox: HTMLInputElement | null = null;

  connectedCallback() {
    this.appendChild(templateTodoItem.content.cloneNode(true));
    this._item = this.querySelector('.item');
    const removeButton = this.querySelector('.destroy');
    this._textElement = this.querySelector('label');
    this._checkbox = this.querySelector('input');
    assert(removeButton);
    removeButton.addEventListener('click', (_e: Event) => {
      this.dispatchEvent(new CustomEvent('onRemove', {detail: this._todoID}));
    });
    assert(this._checkbox);
    this._checkbox.addEventListener('click', (_e: Event) => {
      this.dispatchEvent(
        new CustomEvent<TodoUpdate>('onToggle', {
          detail: {id: this._todoID, completed: !this.completed},
        }),
      );
    });
    this._render();
  }

  set todoID(id: string) {
    this._todoID = id;
  }

  get todoID() {
    return this._todoID;
  }

  get text() {
    return this.getAttribute('text') ?? '';
  }

  set text(v: string) {
    this.setAttribute('text', v);
  }

  get completed() {
    return this.hasAttribute('completed');
  }

  set completed(v: boolean) {
    if (v) {
      this.setAttribute('completed', '');
    } else {
      this.removeAttribute('completed');
    }
  }

  attributeChangedCallback() {
    this._render();
  }

  private _render() {
    const {text, completed} = this;

    if (this._textElement) {
      this._textElement.textContent = text;
    }

    if (this._checkbox) {
      this._checkbox.checked = completed;
    }
    if (this._item) {
      this._item.classList.toggle('completed', completed);
    }
  }
}
