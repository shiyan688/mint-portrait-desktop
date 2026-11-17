'use strict';
/*
 * Execute the checked-in NSIS validator's instructions, not a JS translation of
 * its policy. This deliberately small interpreter fails on unsupported commands.
 * It is a deterministic control-flow regression test, NOT Windows execution.
 *
 * Native boundaries are mocked: Win32 lexical normalization, file attributes,
 * directory enumeration, and NSIS FileFunc's GetRoot/GetParent operations.
 * References for the modeled contracts:
 * https://raw.githubusercontent.com/NSIS-Dev/nsis/v311/Source/exehead/exec.c
 *   EW_GETFULLPATHNAME copies input first, then may clear output on file_exists.
 * https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfullpathnamew
 *   Win32 normalization does not require existence; 0=failure, >=capacity=overflow.
 * https://raw.githubusercontent.com/NSIS-Dev/nsis/v311/Include/FileFunc.nsh
 *   GetRoot returns C: (without slash); GetParent removes the final component.
 */
const path = require('node:path');

function tokenize(line) {
  const tokens = [];
  let current = '', quote = '', started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '$' && line[i + 1] === '\\' && i + 2 < line.length) {
      current += line.slice(i, i + 3); i += 2; started = true; continue;
    }
    if (quote) {
      if (c === quote) quote = ''; else current += c;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c; started = true;
    } else if (c === ';' || c === '#') break;
    else if (/\s/.test(c)) {
      if (started) { tokens.push(current); current = ''; started = false; }
    } else { current += c; started = true; }
  }
  if (quote) throw new Error('Unterminated NSIS string: ' + line);
  if (started) tokens.push(current);
  return tokens;
}

function extractFunctions(source) {
  const functions = new Map();
  for (const prefix of ['', 'un.']) {
    const expanded = source.replaceAll('${PREFIX}', prefix).replaceAll('${NSIS_MAX_STRLEN}', '1024');
    for (const m of expanded.matchAll(/^Function ([^\r\n]+)\r?\n([\s\S]*?)^FunctionEnd/gm)) {
      const lines = m[2].split(/\r?\n/).map(tokenize).filter(t => t.length);
      const labels = new Map();
      const branches = new Map();
      const stack = [];
      lines.forEach((t, i) => {
        if (t[0].endsWith(':')) labels.set(t[0].slice(0, -1), i);
        if (t[0] === '${If}' || t[0] === '${IfNot}') stack.push({start:i});
        if (t[0] === '${Else}') {
          if (!stack.length) throw new Error('Unmatched Else');
          stack.at(-1).otherwise = i;
        }
        if (t[0] === '${EndIf}') {
          const b = stack.pop();
          if (!b) throw new Error('Unmatched EndIf');
          branches.set(b.start, {otherwise: b.otherwise, end:i});
          if (b.otherwise !== undefined) branches.set(b.otherwise, {end:i});
        }
      });
      if (stack.length) throw new Error('Unterminated If');
      functions.set(m[1], {lines, labels, branches});
    }
  }
  return functions;
}

const shellFolders = {
  PROFILE: 'C:\\Users\\Test User',
  DESKTOP: 'C:\\Users\\Test User\\Desktop',
  DOCUMENTS: 'C:\\Users\\Test User\\Documents',
  LOCALAPPDATA: 'C:\\Users\\Test User\\AppData\\Local',
  APPDATA: 'C:\\Users\\Test User\\AppData\\Roaming',
  WINDIR: 'C:\\Windows',
  SYSDIR: 'C:\\Windows\\system32',
  PROGRAMFILES64: 'C:\\Program Files',
};
const key = p => p.replace(/\\+$/, '').toLowerCase();
const getParent = p => {
  p = p.replace(/\\+$/, '');
  const index = p.lastIndexOf('\\');
  return index < 0 ? '' : p.slice(0, index);
};

function runValidator(source, input, options = {}) {
  const functions = extractFunctions(source);
  const vars = {...shellFolders, ...options.variables, INSTDIR: input};
  const files = new Map(Object.entries(options.files || {}).map(([p, value]) => [key(p), value]));
  const stack = [], trace = [], nativeCalls = [], enumerators = new Map();
  let errors = !!options.errors, operations = 0;
  const expand = value => String(value ?? '')
    .replace(/\$\{NSIS_MAX_STRLEN\}/g, '1024')
    .replace(/\$\\([rnt"'])/g, (_, c) => ({r:'\r',n:'\n',t:'\t','"':'"',"'":"'"}[c]))
    .replace(/\$(R\d|\d|[A-Za-z_][A-Za-z0-9_.]*)/g, (_, name) => String(vars[name] ?? ''));
  const assign = (target, value) => {
    if (!/^\$(?:R\d|\d|[A-Za-z_]\w*)$/.test(target)) throw new Error('Unsupported assignment: ' + target);
    vars[target.slice(1)] = String(value).slice(0, 1023);
  };
  const numeric = value => {
    const s = expand(value); return /^[-+]?0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10) || 0;
  };
  const condition = parts => {
    if (parts.length === 1 && parts[0] === '${Errors}') return errors;
    if (parts.length !== 3) throw new Error('Unsupported condition: ' + parts.join(' '));
    const [a, op, b] = parts, left = expand(a), right = expand(b);
    switch (op) {
      case '==': return left.toLowerCase() === right.toLowerCase();
      case '!=': return left.toLowerCase() !== right.toLowerCase();
      case '=': return numeric(a) === numeric(b);
      case '<>': return numeric(a) !== numeric(b);
      case '<': return numeric(a) < numeric(b);
      case '>': return numeric(a) > numeric(b);
      case '<=': return numeric(a) <= numeric(b);
      case '>=': return numeric(a) >= numeric(b);
      default: throw new Error('Unsupported comparison: ' + op);
    }
  };
  function systemCall(signature) {
    const m = /^kernel32::(\w+)\((.*)\)\s+[iIpP]\s+\.r([Rr]?\d)$/.exec(signature);
    if (!m) throw new Error('Unsupported System call: ' + signature);
    const args = m[2].split(/,\s*/).map(arg => tokenize(arg));
    const argument = arg => {
      if (arg[0] !== 'w' && arg[0] !== 'i' && arg[0] !== 'p') throw new Error('Unsupported System type');
      if (/^[rR]\d$/.test(arg[1])) return vars[arg[1][0] === 'R' ? arg[1] : arg[1].slice(1)] || '';
      return expand(arg[1]);
    };
    const resultVar = '$' + (m[3][0] === 'r' ? m[3].slice(1) : m[3]);
    const api = m[1];
    nativeCalls.push({api, input: argument(args[0])});
    if (api === 'GetFileAttributesW') {
      const entry = files.get(key(argument(args[0])));
      assign(resultVar, entry === undefined ? -1 : (entry.attrs ?? 0x10));
    } else if (api === 'GetFullPathNameW') {
      if (args.length !== 4 || !/^\.r[Rr]?\d$/.test(args[2][1])) throw new Error('Unsupported output buffer');
      const raw = argument(args[0]), capacity = Number(argument(args[1]));
      const dest = '$' + args[2][1].replace(/^\.r/, '');
      const normalized = options.normalizedPath ?? path.win32.normalize(raw);
      const result = options.nativeReturn ?? (normalized.length >= capacity ? normalized.length + 1 : normalized.length);
      // On failure or overflow no usable output is guaranteed. Poisoning detects
      // scripts that accidentally consume it before checking the return value.
      assign(dest, result === 0 || result >= capacity ? '<unusable native buffer>' : normalized);
      assign(resultVar, result);
    } else throw new Error('Unsupported native API: ' + api);
  }
  function execute(name) {
    const f = functions.get(name);
    if (!f) throw new Error('Missing function ' + name);
    const jump = (target, pc) => {
      if (!target || target === '0') return pc + 1;
      if (/^[+-]\d+$/.test(target)) return pc + Number(target);
      if (!f.labels.has(target)) throw new Error('Unknown label: ' + target);
      return f.labels.get(target);
    };
    for (let pc = 0; pc < f.lines.length;) {
      if (++operations > 10000) throw new Error('Validator did not terminate');
      const [command, ...args] = f.lines[pc];
      trace.push({function: name, line: pc, command, args: [...args]});
      if (command.endsWith(':')) { pc++; continue; }
      switch (command) {
        case '${If}': case '${IfNot}': {
          let value = condition(args), next = pc + 1;
          if (command === '${IfNot}') value = !value;
          while (['${AndIf}', '${OrIf}'].includes(f.lines[next]?.[0])) {
            const [op, ...rest] = f.lines[next++], result = condition(rest);
            value = op === '${AndIf}' ? value && result : value || result;
          }
          const branch = f.branches.get(pc);
          pc = value ? next : (branch.otherwise ?? branch.end) + 1; continue;
        }
        case '${Else}': pc = f.branches.get(pc).end + 1; continue;
        case '${EndIf}': break;
        case '${AndIf}': case '${OrIf}': throw new Error('Entered an orphaned boolean expression');
        case 'Return': return;
        case 'Call': execute(args[0]); break;
        case 'Goto': case 'goto': pc = jump(args[0], pc); continue;
        case 'StrCmp': case 'StrCmpS': {
          const a = expand(args[0]), b = expand(args[1]);
          const equal = command === 'StrCmp' ? a.toLowerCase() === b.toLowerCase() : a === b;
          pc = jump(equal ? args[2] : args[3], pc); continue;
        }
        case 'IntCmp': {
          const a = numeric(args[0]), b = numeric(args[1]);
          pc = jump(a === b ? args[2] : a < b ? args[3] : args[4], pc); continue;
        }
        case 'StrCpy': {
          const text = expand(args[1]);
          let offset = args[3] === undefined ? 0 : numeric(args[3]);
          if (offset < 0) offset += text.length;
          let result = offset < 0 ? '' : text.slice(offset);
          if (args[2] !== undefined && expand(args[2]) !== '') {
            const length = numeric(args[2]);
            result = length < 0 ? result.slice(0, Math.max(0, result.length + length)) : result.slice(0, length);
          }
          assign(args[0], result); break;
        }
        case 'StrLen': assign(args[0], expand(args[1]).length); break;
        case 'IntOp': {
          const a = numeric(args[1]), b = numeric(args[3]);
          const ops = {'+': () => a + b, '-': () => a - b, '&': () => a & b, '|': () => a | b};
          if (!ops[args[2]]) throw new Error('Unsupported IntOp: ' + args[2]);
          assign(args[0], ops[args[2]]()); break;
        }
        case 'ClearErrors': errors = false; break;
        case 'SetErrors': errors = true; break;
        case 'IfErrors': pc = jump(errors ? args[0] : args[1], pc); continue;
        case 'Push': stack.push(expand(args[0])); break;
        case 'Pop': if (!stack.length) throw new Error('Stack underflow'); assign(args[0], stack.pop()); break;
        case 'GetFullPathName': {
          // NSIS 3.11 command semantics, unlike the Win32 API of the same name.
          // Input expansion precedes output writes, so same-variable use is not
          // itself an aliasing defect. Missing destinations trigger the bug.
          const raw = expand(args[1]);
          if (!files.has(key(raw))) { assign(args[0], ''); errors = true; }
          else assign(args[0], path.win32.normalize(raw));
          nativeCalls.push({api: 'NSIS.GetFullPathName', input: raw}); break;
        }
        case '${GetRoot}': assign(args[1], /^[A-Za-z]:/.test(expand(args[0])) ? expand(args[0]).slice(0, 2) : ''); break;
        case '${GetParent}': assign(args[1], getParent(expand(args[0]))); break;
        case 'System::Call': systemCall(args[0]); break;
        case 'FindFirst': {
          const folder = expand(args[2]).replace(/\\\*$/, ''), entry = files.get(key(folder));
          if (!entry || entry.attrs === 0 || entry.enumerationError) {
            errors = true; assign(args[0], -1); assign(args[1], '');
          } else {
            const handle = String(enumerators.size + 1), names = ['.', '..', ...(entry.entries || [])];
            enumerators.set(handle, {names, index:0});
            assign(args[0], handle); assign(args[1], names[0]);
          }
          break;
        }
        case 'FindNext': {
          const iterator = enumerators.get(expand(args[0]));
          if (!iterator || ++iterator.index >= iterator.names.length) { errors = true; assign(args[1], ''); }
          else assign(args[1], iterator.names[iterator.index]);
          break;
        }
        case 'FindClose': enumerators.delete(expand(args[0])); break;
        default: throw new Error('Unsupported NSIS instruction in validator: ' + command + ' ' + args.join(' '));
      }
      pc++;
    }
  }
  execute(options.functionName || 'CheckSafePath');
  return {path:vars.INSTDIR, failure:vars.Failure || '', vars, errors, trace, nativeCalls, openFindHandles:enumerators.size};
}
module.exports = {runValidator, shellFolders};
