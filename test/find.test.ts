/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { describeElement, findControl } from '../src';
afterEach(() => {
  document.body.innerHTML = '';
});

it('prefers normalized exact names to earlier partial matches and filters roles', () => {
  document.body.innerHTML =
    '<button id="partial">New Key details</button><button id="exact"> New   Key </button><button role="tab">New Key</button>';
  expect(findControl(' NEW key ')?.id).toBe('exact');
  expect(findControl('details')?.id).toBe('partial');
  expect(findControl('new key', { role: 'tab' })?.getAttribute('role')).toBe(
    'tab',
  );
  expect(findControl('new key', { role: 'switch' })).toBeNull();
  expect(findControl('  ')).toBeNull();
  expect(findControl('absent')).toBeNull();
});

it('ignores hidden and skipped controls', () => {
  document.body.innerHTML =
    '<div hidden><button>Hidden</button></div><div inert><button>Inert</button></div><div aria-hidden="true"><button>Decorative</button></div><div style="display:none"><button>Invisible</button></div><aside><button>Assistant</button></aside>';
  // happy-dom has no layout or checkVisibility; supply the browser result.
  for (const element of document.body.querySelectorAll('*')) {
    Object.defineProperty(element, 'checkVisibility', {
      value: () => !element.closest('[style="display:none"]'),
    });
  }
  for (const name of [
    'Hidden',
    'Inert',
    'Decorative',
    'Invisible',
    'Assistant',
  ])
    expect(findControl(name, { skip: 'aside' })).toBeNull();
});

it('uses labels, aria-labelledby and card names without nested action text', () => {
  document.body.innerHTML =
    '<label for="field">Email</label><input id="field"><span id="name">Publish</span><button aria-labelledby="name"></button><div role="button">Card<button>Share</button></div>';
  expect(findControl('Email')?.id).toBe('field');
  expect(findControl('Publish')?.localName).toBe('button');
  expect(findControl('Card')?.getAttribute('role')).toBe('button');
  expect(findControl('Share')?.localName).toBe('button');
});

it('describes nested targets with the nearest configured hint', () => {
  document.body.innerHTML =
    '<button data-action="save"><span>Save</span></button><p>Text</p><aside><button>Ignored</button></aside>';
  const button = document.querySelector('button')!;
  expect(
    describeElement(button.firstElementChild, { hintAttribute: 'data-action' }),
  ).toEqual({ role: 'button', name: 'Save', hint: 'save', element: button });
  expect(describeElement(document.querySelector('p'))).toBeNull();
  expect(
    describeElement(document.querySelector('aside button'), { skip: 'aside' }),
  ).toBeNull();
  expect(describeElement(null)).toBeNull();
  expect(describeElement(document.createTextNode('Text'))).toBeNull();
});
