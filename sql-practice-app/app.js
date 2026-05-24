const markdownUrl = "../materials/sql-cote-practice-daangn-supercent.md";

const state = {
  companyFilter: "all",
  questions: [],
  visibleQuestions: [],
  selectedId: null,
};

const els = {
  reloadBtn: document.getElementById("reloadBtn"),
  companySelect: document.getElementById("companySelect"),
  questionList: document.getElementById("questionList"),
  questionTitle: document.getElementById("questionTitle"),
  questionPrompt: document.getElementById("questionPrompt"),
  functionCards: document.getElementById("functionCards"),
  functionHint: document.getElementById("functionHint"),
  schemaText: document.getElementById("schemaText"),
  sqlInput: document.getElementById("sqlInput"),
  answerPanel: document.getElementById("answerPanel"),
  functionPanel: document.getElementById("functionPanel"),
  answerText: document.getElementById("answerText"),
  explanationText: document.getElementById("explanationText"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
};

const functionLibrary = [
  {
    name: "WITH / CTE",
    pattern: /^\s*WITH\b/i,
    signature: "WITH cte_name AS ( ... )",
    use: "중간 계산 결과에 이름을 붙여 다음 단계에서 다시 쓸 때 사용합니다.",
    tip: "복잡한 SQL을 여러 단계로 나눠 읽기 쉽게 만들 때 가장 먼저 떠올리면 됩니다.",
  },
  {
    name: "DATE_DIFF",
    pattern: /DATE_DIFF\s*\(/i,
    signature: "DATE_DIFF(끝날짜, 시작날짜, DAY)",
    use: "두 날짜 사이의 차이를 일수로 계산합니다.",
    tip: "가입 후 며칠 만에 구매했는지 볼 때 자주 씁니다.",
  },
  {
    name: "COUNT(DISTINCT)",
    pattern: /COUNT\s*\(\s*DISTINCT/i,
    signature: "COUNT(DISTINCT 컬럼)",
    use: "중복된 유저/콘텐츠를 한 번만 셀 때 사용합니다.",
    tip: "퍼널, DAU, 전환율에서 가장 자주 씁니다.",
  },
  {
    name: "COUNTIF",
    pattern: /COUNTIF\s*\(/i,
    signature: "COUNTIF(조건)",
    use: "조건을 만족하는 행의 개수를 셀 때 사용합니다.",
    tip: "view / complete / purchase 같은 이벤트를 셀 때 좋습니다.",
  },
  {
    name: "SAFE_DIVIDE",
    pattern: /SAFE_DIVIDE\s*\(/i,
    signature: "SAFE_DIVIDE(분자, 분모)",
    use: "0으로 나누는 에러 없이 비율을 계산합니다.",
    tip: "전환율, 완주율, 참여율에서 거의 필수입니다.",
  },
  {
    name: "DATE_TRUNC",
    pattern: /DATE_TRUNC\s*\(/i,
    signature: "DATE_TRUNC(날짜, WEEK(MONDAY) / MONTH)",
    use: "날짜를 주/월 단위로 묶을 때 사용합니다.",
    tip: "코호트와 주간 집계에서 자주 나옵니다.",
  },
  {
    name: "DATE_ADD",
    pattern: /DATE_ADD\s*\(/i,
    signature: "DATE_ADD(날짜, INTERVAL n DAY)",
    use: "기준 날짜에 일정 기간을 더할 때 사용합니다.",
    tip: "D1/D7 리텐션 계산에 유용합니다.",
  },
  {
    name: "DATE_SUB",
    pattern: /DATE_SUB\s*\(/i,
    signature: "DATE_SUB(날짜, INTERVAL n DAY)",
    use: "기준 날짜에서 일정 기간을 뺄 때 사용합니다.",
    tip: "최근 7일, 최근 30일 범위를 잡을 때 씁니다.",
  },
  {
    name: "ROW_NUMBER",
    pattern: /ROW_NUMBER\s*\(/i,
    signature: "ROW_NUMBER() OVER (...)",
    use: "각 행에 순서를 매겨 최신 1건만 남길 때 사용합니다.",
    tip: "중복 제거, 최신 이벤트 선택에서 자주 씁니다.",
  },
  {
    name: "LAG",
    pattern: /LAG\s*\(/i,
    signature: "LAG(컬럼) OVER (...)",
    use: "바로 이전 행의 값을 가져올 때 사용합니다.",
    tip: "세션화, 전일 대비 변화 계산에서 자주 쓰입니다.",
  },
  {
    name: "TIMESTAMP_DIFF",
    pattern: /TIMESTAMP_DIFF\s*\(/i,
    signature: "TIMESTAMP_DIFF(끝시각, 시작시각, MINUTE)",
    use: "두 시점의 차이를 계산합니다.",
    tip: "30분 세션 분리 같은 문제에 필요합니다.",
  },
  {
    name: "EXTRACT",
    pattern: /EXTRACT\s*\(/i,
    signature: "EXTRACT(DAYOFWEEK FROM 날짜)",
    use: "날짜에서 요일, 월 같은 특정 값을 꺼낼 때 사용합니다.",
    tip: "요일별 구매 패턴, 월별 집계에 자주 씁니다.",
  },
  {
    name: "QUALIFY",
    pattern: /QUALIFY\s+/i,
    signature: "QUALIFY 조건",
    use: "윈도우 함수 결과를 바로 걸러낼 때 사용합니다.",
    tip: "ROW_NUMBER() 뒤에 바로 붙이는 패턴을 기억하세요.",
  },
  {
    name: "CASE WHEN",
    pattern: /CASE\s+WHEN/i,
    signature: "CASE WHEN 조건 THEN 값 ELSE 값 END",
    use: "조건에 따라 값을 나눌 때 사용합니다.",
    tip: "퍼널 단계, 그룹 분기, 라벨링에 자주 씁니다.",
  },
  {
    name: "IFNULL",
    pattern: /IFNULL\s*\(/i,
    signature: "IFNULL(값, 대체값)",
    use: "값이 비어 있을 때 기본값으로 바꿉니다.",
    tip: "매출이나 이벤트가 없는 경우 0으로 바꿀 때 씁니다.",
  },
  {
    name: "COALESCE",
    pattern: /COALESCE\s*\(/i,
    signature: "COALESCE(값1, 값2, ...)",
    use: "비어 있지 않은 첫 번째 값을 고를 때 사용합니다.",
    tip: "NULL 보정이 여러 단계일 때 IFNULL보다 유연합니다.",
  },
  {
    name: "SUM",
    pattern: /SUM\s*\(/i,
    signature: "SUM(컬럼)",
    use: "값을 모두 더할 때 사용합니다.",
    tip: "매출, 총 이벤트 수, 누적 지표에 자주 씁니다.",
  },
  {
    name: "AVG",
    pattern: /AVG\s*\(/i,
    signature: "AVG(컬럼)",
    use: "평균을 계산할 때 사용합니다.",
    tip: "평균 시청시간, 평균 매출, 평균 세션 길이에 쓰입니다.",
  },
  {
    name: "MIN / MAX",
    pattern: /\b(MIN|MAX)\s*\(/i,
    signature: "MIN(컬럼) / MAX(컬럼)",
    use: "가장 이른 시점이나 가장 늦은 시점을 찾을 때 사용합니다.",
    tip: "첫 이벤트, 마지막 이벤트를 찾을 때 자주 씁니다.",
  },
  {
    name: "UNION DISTINCT",
    pattern: /UNION\s+DISTINCT/i,
    signature: "SELECT ... UNION DISTINCT SELECT ...",
    use: "두 결과를 합치되 중복을 제거할 때 사용합니다.",
    tip: "여러 이벤트 유저를 한 리스트로 합칠 때 좋습니다.",
  },
  {
    name: "UNION ALL",
    pattern: /UNION\s+ALL/i,
    signature: "SELECT ... UNION ALL SELECT ...",
    use: "두 결과를 중복 유지한 채 합칠 때 사용합니다.",
    tip: "행을 그대로 붙여야 할 때 사용합니다.",
  },
  {
    name: "LEFT JOIN",
    pattern: /LEFT\s+JOIN/i,
    signature: "LEFT JOIN 다른표 ON 조건",
    use: "왼쪽 표는 유지하고 오른쪽 표를 붙일 때 사용합니다.",
    tip: "누락 데이터를 보존하고 싶을 때 중요합니다.",
  },
  {
    name: "GROUP BY",
    pattern: /GROUP\s+BY/i,
    signature: "GROUP BY 기준컬럼",
    use: "같은 기준끼리 묶어서 집계할 때 사용합니다.",
    tip: "DAU, 퍼널, 카테고리별 성과 집계의 기본입니다.",
  },
  {
    name: "HAVING",
    pattern: /HAVING/i,
    signature: "HAVING 집계조건",
    use: "집계한 뒤에 다시 조건을 걸 때 사용합니다.",
    tip: "중복 카운트, 상위/하위 필터링에서 씁니다.",
  },
  {
    name: "ORDER BY",
    pattern: /ORDER\s+BY/i,
    signature: "ORDER BY 컬럼 DESC / ASC",
    use: "정렬 순서를 정할 때 사용합니다.",
    tip: "Top N, 최신순, 오름차순 정렬에 쓰입니다.",
  },
  {
    name: "LIMIT",
    pattern: /LIMIT\s+\d+/i,
    signature: "LIMIT 숫자",
    use: "결과를 상위 몇 개만 볼 때 사용합니다.",
    tip: "Top 10 문제에서 자주 등장합니다.",
  },
];

function normalizeText(text) {
  return text.replace(/\r\n/g, "\n").trim();
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function explainSqlLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("WITH ")) return "중간 계산용 표(CTE)를 먼저 만듭니다.";
  if (trimmed === "WITH") return "중간 계산용 표를 만들기 시작합니다.";
  if (trimmed.startsWith("SELECT")) return "최종으로 보여줄 열을 고릅니다.";
  if (trimmed.startsWith("FROM ")) return "어느 표에서 가져올지 적습니다.";
  if (trimmed.startsWith("JOIN ")) return "다른 표를 붙여 필요한 정보를 가져옵니다.";
  if (trimmed.startsWith("LEFT JOIN")) return "왼쪽 표를 기준으로, 오른쪽 표를 붙입니다.";
  if (trimmed.startsWith("RIGHT JOIN")) return "오른쪽 표를 기준으로, 왼쪽 표를 붙입니다.";
  if (trimmed.startsWith("FULL JOIN")) return "양쪽 표를 모두 살려 붙입니다.";
  if (trimmed.startsWith("WHERE ")) return "조건에 맞는 행만 남깁니다.";
  if (trimmed.startsWith("GROUP BY")) return "같은 기준끼리 묶어서 집계합니다.";
  if (trimmed.startsWith("ORDER BY")) return "정렬 순서를 정합니다.";
  if (trimmed.startsWith("HAVING")) return "집계 결과에 조건을 다시 겁니다.";
  if (trimmed.startsWith("LIMIT")) return "상위 몇 개만 봅니다.";
  if (trimmed.startsWith("QUALIFY")) return "윈도우 함수 결과를 바로 걸러냅니다.";
  if (trimmed.startsWith("UNION DISTINCT")) return "중복을 제거하면서 표를 합칩니다.";
  if (trimmed.startsWith("UNION ALL")) return "중복을 유지한 채 표를 합칩니다.";
  if (trimmed.startsWith("CASE WHEN")) return "조건에 따라 값을 나눕니다.";
  if (trimmed.includes("COUNT(DISTINCT")) return "중복된 대상은 한 번만 셉니다.";
  if (trimmed.includes("COUNTIF")) return "조건을 만족하는 개수를 셉니다.";
  if (trimmed.includes("SAFE_DIVIDE")) return "0으로 나누는 에러를 막고 비율을 계산합니다.";
  if (trimmed.includes("ROW_NUMBER")) return "행에 순서를 매깁니다.";
  if (trimmed.includes("LAG(")) return "바로 이전 행의 값을 가져옵니다.";
  if (trimmed.includes("TIMESTAMP_DIFF")) return "두 시점의 차이를 계산합니다.";
  if (trimmed.includes("DATE_DIFF")) return "두 날짜의 차이를 계산합니다.";
  if (trimmed.includes("EXTRACT")) return "날짜에서 요일이나 월 같은 값을 꺼냅니다.";
  if (trimmed.includes("DATE_TRUNC")) return "날짜를 주/월 단위로 묶습니다.";
  if (trimmed.includes("DATE_ADD")) return "날짜에 지정한 기간을 더합니다.";
  if (trimmed.includes("DATE_SUB")) return "날짜에서 지정한 기간을 뺍니다.";
  if (trimmed.includes("MIN(")) return "가장 이른 시점을 찾습니다.";
  if (trimmed.includes("MAX(")) return "가장 늦은 시점을 찾습니다.";
  if (trimmed.includes("SUM(")) return "값을 모두 더합니다.";
  if (trimmed.includes("AVG(")) return "평균을 구합니다.";
  if (trimmed.includes("IFNULL")) return "값이 비어 있으면 0으로 바꿉니다.";
  if (trimmed.includes("COUNT(*)")) return "행 개수를 셉니다.";
  if (trimmed.startsWith("SELECT *")) return "모든 열을 그대로 봅니다.";
  return "";
}

function annotateSql(sql) {
  return sql
    .split("\n")
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      const comment = explainSqlLine(trimmed);
      const note = comment ? `<span class="sql-note">${escapeHtml(comment)}</span>` : "";
      const rowClass = comment ? "sql-row" : "sql-row no-note";
      return `
        <div class="${rowClass}">
          <span class="sql-line-no">${index + 1}</span>
          <code class="sql-code">${escapeHtml(line)}</code>
          ${note}
        </div>
      `;
    })
    .filter(Boolean)
    .join("");
}

function extractFunctionCards(sql) {
  const matched = [];
  const upper = sql.toUpperCase();

  for (const item of functionLibrary) {
    if (item.pattern.test(upper) && !matched.some((x) => x.name === item.name)) {
      matched.push(item);
    }
  }

  return matched;
}

function renderFunctionCards(question) {
  const cards = extractFunctionCards(question?.answerSql || "");

  if (!els.functionCards) return;
  if (!cards.length) {
    els.functionCards.innerHTML = `
      <div class="function-empty">
        이 문제에서 바로 보이는 핵심 함수가 없습니다.
      </div>
    `;
    if (els.functionHint) {
      els.functionHint.textContent = "필요한 함수가 적은 문제입니다.";
    }
    return;
  }

  if (els.functionHint) {
    els.functionHint.textContent = "문제에 나온 함수만 골라서 간단히 정리했습니다.";
  }

  els.functionCards.innerHTML = cards
    .map(
      (item) => `
        <article class="function-card">
          <p class="function-name">${escapeHtml(item.name)}</p>
          <code class="function-signature">${escapeHtml(item.signature)}</code>
          <p class="function-use">${escapeHtml(item.use)}</p>
          <p class="function-tip">${escapeHtml(item.tip)}</p>
        </article>
      `
    )
    .join("");
}

function parseMarkdown(md) {
  const lines = normalizeText(md).split("\n");
  const schemaBlocks = {
    당근: [],
    슈퍼센트: [],
    "초보-중간": [],
  };
  const questions = [];

  let currentCompany = null;
  let currentQuestion = null;
  let currentSchemaCompany = null;
  let inQuestionSection = false;

  const finalizeQuestion = () => {
    if (!currentQuestion) return;
    const before = currentQuestion.beforeLines.join("\n").trim();
    const after = currentQuestion.afterLines.join("\n").trim();
    const beforeLines = before.split("\n").map((line) => line.trim()).filter(Boolean);
    const firstLine = beforeLines[0] || "";
    const drilldown = firstLine.replace(/^드릴다운:\s*/, "").trim();
    const promptExtra = beforeLines.slice(1).join("\n").trim();
    const explanation = after.replace(/^풀이 주석:\s*/, "").trim();

    questions.push({
      ...currentQuestion,
      drilldown,
      promptExtra,
      explanation,
      answerSql: currentQuestion.answerLines.join("\n").trim(),
      schema: schemaBlocks[currentQuestion.company].join("\n").trim(),
    });
    currentQuestion = null;
  };

  for (const line of lines) {
    const schemaCompanyMatch = line.match(/^###\s+(당근 숏폼|슈퍼센트|초보-중간)$/);
    const companyMatch = line.match(/^##\s+1\)\s+당근/);
    const supercentMatch = line.match(/^##\s+2\)\s+슈퍼센트/);
    const beginnerMatch = line.match(/^##\s+3\)\s+초보-중간/);
    const questionMatch = line.match(/^###\s+(\d+)\.\s+(.*)$/);

    if (schemaCompanyMatch) {
      currentSchemaCompany = schemaCompanyMatch[1].includes("당근") ? "당근" : "슈퍼센트";
      continue;
    }

    if (companyMatch) {
      finalizeQuestion();
      currentCompany = "당근";
      inQuestionSection = true;
      currentSchemaCompany = null;
      continue;
    }

    if (supercentMatch) {
      finalizeQuestion();
      currentCompany = "슈퍼센트";
      inQuestionSection = true;
      currentSchemaCompany = null;
      continue;
    }

    if (beginnerMatch) {
      finalizeQuestion();
      currentCompany = "초보-중간";
      inQuestionSection = true;
      currentSchemaCompany = null;
      continue;
    }

    if (!currentCompany) {
      if (currentSchemaCompany) {
        schemaBlocks[currentSchemaCompany].push(line);
      }
      continue;
    }

    if (questionMatch) {
      finalizeQuestion();
      currentQuestion = {
        id: `${currentCompany}-${questionMatch[1]}`,
        company: currentCompany,
        title: questionMatch[2].trim(),
        beforeLines: [],
        afterLines: [],
        answerLines: [],
        inCode: false,
      };
      continue;
    }

    if (!inQuestionSection) {
      continue;
    }

    if (!currentQuestion) {
      continue;
    }

    if (line.trim().startsWith("```")) {
      currentQuestion.inCode = !currentQuestion.inCode;
      continue;
    }

    if (currentQuestion.inCode) {
      currentQuestion.answerLines.push(line);
    } else if (currentQuestion.answerLines.length === 0) {
      currentQuestion.beforeLines.push(line);
    } else {
      currentQuestion.afterLines.push(line);
    }
  }

  finalizeQuestion();
  return questions.filter((q) => q.title);
}

function getStorageKey(name) {
  return `sql-practice:${name}`;
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(getStorageKey(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(getStorageKey(key), JSON.stringify(value));
}

function getVisibleQuestions() {
  if (state.companyFilter === "all") return state.questions;
  return state.questions.filter((q) => q.company === state.companyFilter);
}

function getCurrentQuestion() {
  return state.questions.find((q) => q.id === state.selectedId) || null;
}

function renderList() {
  const current = getCurrentQuestion();
  els.questionList.innerHTML = "";

  state.visibleQuestions.forEach((q) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `question-item ${current?.id === q.id ? "active" : ""}`;
    btn.innerHTML = `
      <span class="q-title">${q.title}</span>
      <span class="q-sub">${q.drilldown.slice(0, 80) || "드릴다운 없음"}</span>
    `;
    btn.addEventListener("click", () => {
      state.selectedId = q.id;
      saveJson("selectedId", state.selectedId);
      renderAll();
    });
    els.questionList.appendChild(btn);
  });
}

function renderQuestion() {
  const q = getCurrentQuestion();
  const drafts = loadJson("draftMap", {});

  if (!q) {
    els.questionTitle.textContent = "문제를 선택하세요";
    els.questionPrompt.textContent = "";
    renderFunctionCards(null);
    els.schemaText.textContent = "";
    els.sqlInput.value = "";
    els.answerText.textContent = "";
    els.explanationText.textContent = "";
    if (els.answerPanel) els.answerPanel.open = false;
    if (els.functionPanel) els.functionPanel.open = false;
    return;
  }

  els.questionTitle.textContent = q.title;
  els.questionPrompt.textContent = [q.drilldown, q.promptExtra].filter(Boolean).join("\n\n");
  renderFunctionCards(q);
  els.schemaText.textContent = q.schema || "스키마를 불러오지 못했습니다.";
  els.sqlInput.value = drafts[q.id] || "";
  els.answerText.innerHTML = q.answerSql ? annotateSql(q.answerSql) : "<p class='empty-answer'>정답이 없습니다.</p>";
  els.explanationText.textContent = q.explanation || "풀이 주석이 없습니다.";
  if (els.answerPanel) els.answerPanel.open = false;
  if (els.functionPanel) els.functionPanel.open = false;
}

function renderFilters() {
  if (els.companySelect) {
    els.companySelect.value = state.companyFilter;
  }
}

function renderNavButtons() {
  const currentIndex = state.visibleQuestions.findIndex((q) => q.id === state.selectedId);
  els.prevBtn.disabled = currentIndex <= 0;
  els.nextBtn.disabled = currentIndex === -1 || currentIndex >= state.visibleQuestions.length - 1;
}

function renderAll() {
  state.visibleQuestions = getVisibleQuestions();
  if (!state.visibleQuestions.some((q) => q.id === state.selectedId)) {
    state.selectedId = state.visibleQuestions[0]?.id || null;
    saveJson("selectedId", state.selectedId);
  }
  renderFilters();
  renderList();
  renderQuestion();
  renderNavButtons();
}

function initHandlers() {
  els.companySelect?.addEventListener("change", () => {
    state.companyFilter = els.companySelect.value;
    saveJson("companyFilter", state.companyFilter);
    renderAll();
  });

  els.reloadBtn.addEventListener("click", async () => {
    await boot(true);
  });

  els.sqlInput.addEventListener("input", () => {
    const q = getCurrentQuestion();
    if (!q) return;
    const drafts = loadJson("draftMap", {});
    drafts[q.id] = els.sqlInput.value;
    saveJson("draftMap", drafts);
  });

  els.prevBtn.addEventListener("click", () => {
    const idx = state.visibleQuestions.findIndex((q) => q.id === state.selectedId);
    if (idx > 0) {
      state.selectedId = state.visibleQuestions[idx - 1].id;
      saveJson("selectedId", state.selectedId);
      renderAll();
    }
  });

  els.nextBtn.addEventListener("click", () => {
    const idx = state.visibleQuestions.findIndex((q) => q.id === state.selectedId);
    if (idx >= 0 && idx < state.visibleQuestions.length - 1) {
      state.selectedId = state.visibleQuestions[idx + 1].id;
      saveJson("selectedId", state.selectedId);
      renderAll();
    }
  });
}

async function boot(forceReload = false) {
  const cached = loadJson("questionsCache", null);
  const cachedAt = loadJson("questionsCacheAt", null);

  try {
    const response = await fetch(`${markdownUrl}${forceReload ? `?v=${Date.now()}` : ""}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const markdown = await response.text();
    const questions = parseMarkdown(markdown);
    state.questions = questions;
    saveJson("questionsCache", questions);
    saveJson("questionsCacheAt", new Date().toISOString());
  } catch (error) {
    console.warn("Markdown fetch failed, using cache or fallback.", error);
    if (cached?.length) {
      state.questions = cached;
    } else {
      state.questions = [];
    }
  }

  state.companyFilter = loadJson("companyFilter", "all");
  state.selectedId = loadJson("selectedId", null);
  if (!state.selectedId) state.selectedId = state.questions[0]?.id || null;
  renderAll();
}

initHandlers();
boot();
