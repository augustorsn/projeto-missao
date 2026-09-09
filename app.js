const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const KEY_STORAGE = "claude_test_writer_api_key";
// Haiku 4.5 rejects output_config.effort (older thinking model) - only Sonnet 5 / Opus 5 support it.
const EFFORT_SUPPORTED_MODELS = new Set(["claude-sonnet-5", "claude-opus-5"]);

const els = {
  apiKey: document.getElementById("apiKey"),
  saveKey: document.getElementById("saveKey"),
  keyStatus: document.getElementById("keyStatus"),
  model: document.getElementById("model"),
  effort: document.getElementById("effort"),
  framework: document.getElementById("framework"),
  mode: document.getElementById("mode"),
  folderPanel: document.getElementById("folderPanel"),
  filesPanel: document.getElementById("filesPanel"),
  pastePanel: document.getElementById("pastePanel"),
  pasteFileName: document.getElementById("pasteFileName"),
  pickFolder: document.getElementById("pickFolder"),
  folderName: document.getElementById("folderName"),
  unsupported: document.getElementById("unsupported"),
  fileList: document.getElementById("fileList"),
  currentFile: document.getElementById("currentFile"),
  generateBtn: document.getElementById("generateBtn"),
  sourceArea: document.getElementById("sourceArea"),
  specPreview: document.getElementById("specPreview"),
  specName: document.getElementById("specName"),
  copySpec: document.getElementById("copySpec"),
  log: document.getElementById("log"),
};

let rootDirHandle = null;
let entries = []; // {name, path, fileHandle, dirHandle, hasSpec}
let selected = null;
let lastGeneratedCode = "";

// --- Mode toggle ---
function applyMode() {
  const isPaste = els.mode.value === "paste";
  els.folderPanel.hidden = isPaste;
  els.filesPanel.hidden = isPaste;
  els.pastePanel.hidden = !isPaste;
  els.sourceArea.readOnly = !isPaste;
  selected = null;
  els.generateBtn.disabled = true;
  els.sourceArea.value = "";
  els.specPreview.textContent = "";
  els.specName.textContent = "-";
  els.currentFile.textContent = "Nenhum arquivo selecionado";
  els.copySpec.hidden = true;

  if (isPaste) {
    document.querySelectorAll(".file-item").forEach((el) => el.classList.remove("active"));
    els.currentFile.textContent = els.pasteFileName.value.trim() || "arquivo.ts";
    els.specName.textContent = toSpecName(els.pasteFileName.value.trim() || "arquivo.ts");
  }
}

els.mode.addEventListener("change", applyMode);

function refreshPasteState() {
  if (els.mode.value !== "paste") return;
  const name = els.pasteFileName.value.trim() || "arquivo.ts";
  els.currentFile.textContent = name;
  els.specName.textContent = toSpecName(name);
  els.generateBtn.disabled = els.sourceArea.value.trim().length === 0;
}

els.pasteFileName.addEventListener("input", refreshPasteState);
els.sourceArea.addEventListener("input", refreshPasteState);

function refreshEffortAvailability() {
  els.effort.disabled = !EFFORT_SUPPORTED_MODELS.has(els.model.value);
}
els.model.addEventListener("change", refreshEffortAvailability);

function log(msg, cls) {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${msg}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

// --- API key persistence ---
function loadKey() {
  const key = localStorage.getItem(KEY_STORAGE);
  if (key) {
    els.apiKey.value = key;
    els.keyStatus.textContent = "salva neste navegador";
  }
}

els.saveKey.addEventListener("click", () => {
  const key = els.apiKey.value.trim();
  if (!key) {
    localStorage.removeItem(KEY_STORAGE);
    els.keyStatus.textContent = "removida";
    return;
  }
  localStorage.setItem(KEY_STORAGE, key);
  els.keyStatus.textContent = "salva neste navegador";
  log("API key salva no localStorage deste navegador.", "ok");
});

// --- Folder access (File System Access API, Chromium only) ---
if (!("showDirectoryPicker" in window)) {
  els.unsupported.hidden = false;
  els.pickFolder.disabled = true;
}

els.pickFolder.addEventListener("click", async () => {
  try {
    rootDirHandle = await window.showDirectoryPicker();
    els.folderName.textContent = `Pasta: ${rootDirHandle.name}`;
    log(`Pasta "${rootDirHandle.name}" selecionada. Escaneando...`);
    entries = [];
    await walk(rootDirHandle, "");
    renderFileList();
    log(`${entries.length} arquivo(s) .ts encontrados.`, "ok");
  } catch (err) {
    if (err.name !== "AbortError") log(`Erro ao selecionar pasta: ${err.message}`, "err");
  }
});

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

async function walk(dirHandle, path) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "directory") {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      await walk(handle, path ? `${path}/${name}` : name);
    } else if (handle.kind === "file") {
      const isTs = name.endsWith(".ts") || name.endsWith(".tsx");
      const isSpecOrDecl =
        name.endsWith(".spec.ts") || name.endsWith(".test.ts") ||
        name.endsWith(".spec.tsx") || name.endsWith(".test.tsx") ||
        name.endsWith(".d.ts");
      if (isTs && !isSpecOrDecl) {
        entries.push({
          name,
          path: path ? `${path}/${name}` : name,
          fileHandle: handle,
          dirHandle,
        });
      }
    }
  }
}

async function specExists(entry) {
  const specName = toSpecName(entry.name);
  try {
    await entry.dirHandle.getFileHandle(specName);
    return true;
  } catch {
    return false;
  }
}

function toSpecName(name) {
  return name.replace(/\.tsx?$/, (m) => (m === ".tsx" ? ".spec.tsx" : ".spec.ts"));
}

async function renderFileList() {
  els.fileList.innerHTML = "";
  for (const entry of entries) {
    entry.hasSpec = await specExists(entry);
    const item = document.createElement("div");
    item.className = "file-item" + (entry.hasSpec ? " has-spec" : "");
    item.textContent = entry.path;
    item.title = entry.path;
    item.addEventListener("click", () => selectEntry(entry, item));
    els.fileList.appendChild(item);
  }
}

async function selectEntry(entry, itemEl) {
  selected = entry;
  document.querySelectorAll(".file-item").forEach((el) => el.classList.remove("active"));
  if (itemEl) itemEl.classList.add("active");

  els.currentFile.textContent = entry.path;
  els.specName.textContent = toSpecName(entry.name);
  els.generateBtn.disabled = false;
  els.specPreview.textContent = "";
  els.copySpec.hidden = true;

  const file = await entry.fileHandle.getFile();
  const text = await file.text();
  entry.sourceText = text;
  els.sourceArea.value = text;
}

// --- Prompting ---
function buildPrompt(entry) {
  const framework = els.framework.value;
  const specName = toSpecName(entry.name);

  const frameworkInstructions = {
    jest: "Use Jest (describe/it/expect, jest.fn() para mocks). Importe do caminho relativo correto.",
    vitest: "Use Vitest (import { describe, it, expect, vi } from 'vitest'). Importe do caminho relativo correto.",
    jasmine: "Use Jasmine com Angular TestBed quando aplicável (describe/it/expect, jasmine.createSpy para mocks). Configure TestBed se o arquivo for um componente, serviço ou pipe Angular.",
  }[framework];

  return `Você é um gerador de testes unitários TypeScript.

Escreva o conteúdo COMPLETO do arquivo de teste "${specName}" para o código-fonte abaixo (arquivo original: "${entry.name}").

Regras:
- ${frameworkInstructions}
- Se o arquivo contiver MAIS DE UMA classe, componente, função ou constante exportada (múltiplos "export class"/"export function"/"export const"), gere testes para CADA exportação, uma após a outra, no MESMO arquivo de teste — use um bloco "describe" de nível superior por exportação, nomeado com o nome dela.
- Cubra os principais caminhos de execução, casos de borda e condições de erro de cada exportação testada.
- O import deve usar caminho relativo "./${entry.name.replace(/\.tsx?$/, "")}", trazendo (via import nomeado) cada exportação que for testada.
- Responda APENAS com o código do arquivo de teste, sem explicações, sem markdown, sem blocos de código (sem \`\`\`).

Código-fonte de "${entry.name}":
---
${entry.sourceText}
---`;
}

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

async function callClaude(prompt) {
  const key = els.apiKey.value.trim();
  if (!key) throw new Error("Informe e salve sua API key primeiro.");

  const body = {
    model: els.model.value,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  };
  if (EFFORT_SUPPORTED_MODELS.has(els.model.value)) {
    body.output_config = { effort: els.effort.value };
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`API retornou ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock) throw new Error("Resposta da API sem conteúdo de texto.");
  return textBlock.text;
}

async function writeSpecFile(entry, content) {
  const specName = toSpecName(entry.name);
  const specHandle = await entry.dirHandle.getFileHandle(specName, { create: true });
  const writable = await specHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return specName;
}

els.generateBtn.addEventListener("click", async () => {
  const isPaste = els.mode.value === "paste";
  const active = isPaste
    ? { name: els.pasteFileName.value.trim() || "arquivo.ts", sourceText: els.sourceArea.value }
    : selected;

  if (!active || !active.sourceText) return;

  els.generateBtn.disabled = true;
  els.generateBtn.textContent = "Gerando...";
  els.specPreview.textContent = "";
  els.copySpec.hidden = true;
  try {
    log(`Gerando testes para ${isPaste ? active.name : active.path}...`);
    const prompt = buildPrompt(active);
    const raw = await callClaude(prompt);
    const code = stripCodeFences(raw);
    els.specPreview.textContent = code;
    lastGeneratedCode = code;
    els.copySpec.hidden = false;

    if (isPaste) {
      log(`Teste gerado. Use "Copiar" e cole em ${toSpecName(active.name)}.`, "ok");
    } else {
      const specName = await writeSpecFile(active, code);
      active.hasSpec = true;
      log(`Arquivo "${specName}" escrito com sucesso em ${active.path.replace(active.name, "")}.`, "ok");
      renderFileList().then(() => {
        const idx = entries.indexOf(active);
        const items = document.querySelectorAll(".file-item");
        if (items[idx]) items[idx].classList.add("active");
      });
    }
  } catch (err) {
    log(`Erro: ${err.message}`, "err");
  } finally {
    els.generateBtn.disabled = false;
    els.generateBtn.textContent = "Gerar testes";
  }
});

els.copySpec.addEventListener("click", async () => {
  if (!lastGeneratedCode) return;
  try {
    await navigator.clipboard.writeText(lastGeneratedCode);
    log("Código copiado para a área de transferência.", "ok");
  } catch (err) {
    log(`Não foi possível copiar automaticamente: ${err.message}. Selecione o texto manualmente.`, "err");
  }
});

loadKey();
applyMode();
refreshEffortAvailability();
