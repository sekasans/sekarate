// tsv-extractor.js
(() => {
  const DIFF = {0:"BAS",1:"ADV",2:"EXP",3:"MAS",4:"ULT"};

  const DIFF_CLASS = {
    "0": "basic",
    "1": "advanced",
    "2": "expert",
    "3": "master",
    "4": "ultima"
  };

  const BASE = location.origin + "/chuni-mobile/html/mobile/home/playerData/";
  const DETAIL_API = location.origin + "/chuni-mobile/html/mobile/record/musicGenre/sendMusicDetail/";

  const PAGES = [
    { frame: "BEST", path: "ratingDetailBest/" },
    { frame: "NEW",  path: "ratingDetailRecent/" }
  ];

  //const RECEIVER_URL = "http://127.0.0.1:5500/index.html";
  const RECEIVER_URL = "https://sekasans.github.io/sekarate/";

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeNumber(s) {
    return String(s)
      .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[，,]/g, "")
      .replace(/回/g, "")
      .trim();
  }

  function extractPlayerName(doc) {
    const el = doc.querySelector(".player_name_in");
    return el ? el.textContent.trim() : "";
  }

  function findDifficultyBox(doc, diffId) {
    const diffClass = DIFF_CLASS[String(diffId)];
    if (!diffClass) return null;

    let box = doc.querySelector(".music_box.bg_" + diffClass);

    if (!box) {
      const titleEl = doc.querySelector(".musicdata_detail_difficulty.title_" + diffClass);
      box = titleEl ? titleEl.closest(".music_box") : null;
    }

    return box;
  }

  function extractClearStatus(doc, diffId) {
    const box = findDifficultyBox(doc, diffId);
    if (!box) return "";

    const html = box.innerHTML || "";

    if (html.includes("icon_alljusticecritical.png")) return "AJC";
    if (html.includes("icon_alljustice.png")) return "AJ";
    if (html.includes("icon_fullcombo.png")) return "FC";

    return "";
  }

  function scrape(doc, frame) {
    const rows = [];

    doc.querySelectorAll("div.musiclist_box").forEach(box => {
      const titleEl = box.querySelector(".music_title");
      const title = titleEl ? titleEl.textContent.trim() : "";

      const scoreEl = box.querySelector(".play_musicdata_highscore .text_b");
      const score = scoreEl ? scoreEl.textContent.trim().replace(/,/g, "") : "";

      const form = box.closest("form");
      const idxInput  = form ? form.querySelector("input[name='idx']")  : null;
      const diffInput = form ? form.querySelector("input[name='diff']") : null;

      const idx = idxInput && idxInput.value ? idxInput.value : "";
      const diffId = diffInput && diffInput.value ? diffInput.value : "";
      const diff = Object.prototype.hasOwnProperty.call(DIFF, diffId)
        ? DIFF[diffId]
        : diffId;

      if (title && score) {
        rows.push({
          frame,
          title,
          diff,
          diffId,
          score,
          idx,
          playCount: "",
          clear: ""
        });
      }
    });

    return rows;
  }

  function fetchDoc(url) {
    return fetch(url, { credentials: "include" })
      .then(res => res.text())
      .then(html => new DOMParser().parseFromString(html, "text/html"));
  }

  function extractToken(doc) {
    const tokenInput =
      doc.querySelector("input[name='token']") ||
      doc.querySelector("input[name='_token']");

    if (tokenInput && tokenInput.value) {
      return tokenInput.value;
    }

    const html = doc.documentElement.innerHTML;
    const m = html.match(/token['"]?\s*[:=]\s*['"]([a-f0-9]{16,})['"]/i);
    return m ? m[1] : "";
  }

  function extractPlayCount(doc, diffId) {
    const diffClass = DIFF_CLASS[String(diffId)];
    if (!diffClass) return "";

    const box = findDifficultyBox(doc, diffId);

    if (!box) {
      console.warn("対象難易度のmusic_boxが見つかりません:", diffId, diffClass);
      return "";
    }

    const scoreBlocks = Array.from(box.querySelectorAll(".block_underline"));

    for (const block of scoreBlocks) {
      const titleEl = block.querySelector(".musicdata_score_title");
      const numEl = block.querySelector(".musicdata_score_num .text_b, .musicdata_score_num");

      const title = titleEl ? titleEl.textContent.trim() : "";

      if (title.indexOf("プレイ回数") !== -1 && numEl) {
        return normalizeNumber(numEl.textContent);
      }
    }

    // 念のため fallback：対象box内テキストから拾う
    const text = (box.textContent || "").replace(/\s+/g, " ");
    const m = text.match(/プレイ回数\s*[：:]\s*([0-9０-９,，]+)\s*回/);

    return m ? normalizeNumber(m[1]) : "";
  }

  async function fetchPlayCount(row, token) {
    if (!row.idx || !row.diffId || !token) return "";

    const body = new URLSearchParams();
    body.set("idx", row.idx);
    body.set("genre", "99");
    body.set("diff", row.diffId);
    body.set("token", token);

    const res = await fetch(DETAIL_API, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });

    const html = await res.text();

    // Rate Limit検知
    if (
      html.includes("Error Code: 200001") ||
      html.includes("短時間の連続アクセス")
    ) {
      throw new Error("Rate limited (200001)");
    }

    if (
      html.includes("アクセスが集中") ||
      html.includes("エラー") ||
      html.includes("Error Code")
    ) {
      console.warn("詳細取得HTML異常:", row.title, row.diff, row.idx);
      console.log(html);
    }

    const doc = new DOMParser().parseFromString(html, "text/html");

    const playCount = extractPlayCount(doc, row.diffId);
    const clear = extractClearStatus(doc, row.diffId);

    if (!playCount) {
      console.warn(
        "playCount取得失敗:",
        row.title,
        row.diff,
        row.idx
      );

      console.log(
        "music_box classes:",
        [...doc.querySelectorAll(".music_box")].map(x => x.className)
      );

      console.log(doc.body ? doc.body.innerHTML : html);
    }

    return { playCount, clear };
  }

  async function hydratePlayCounts(rows, token) {
    const CONCURRENCY = 1;
    const BATCH_SLEEP = 0;

    let completed = 0;

    const start = performance.now();
    showProgressOverlay(rows.length);

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);

      await Promise.all(
        chunk.map(async row => {
          try {
            const detail = await fetchPlayCount(row, token);
            row.playCount = detail.playCount || "";
            row.clear = detail.clear || "";
          } catch (e) {
            console.warn(
              "playCount取得失敗:",
              row.title,
              row.diff,
              e.message || e
            );

            row.playCount = "";
            row.clear = "";
          }

          completed++;

          console.log(
            `[${completed}/${rows.length}] ${row.title} ${row.diff} playCount=${row.playCount} clear=${row.clear || "-"}`
          );
          updateProgressOverlay(completed, rows.length);
        })
      );

      if (i + CONCURRENCY < rows.length) {
        await sleep(BATCH_SLEEP);
      }
    }

    hideProgressOverlay();

    console.log(
      `playCount取得完了: ${Math.round(performance.now() - start)}ms`
    );

    return rows;
  }

  function buildTsv(results, playerName) {
    const header = ["frame","title","diff","score","idx","playCount","clear"];

    const lines = [header.join("\t")].concat(
      results.map(r => [
        r.frame,
        r.title,
        r.diff,
        r.score,
        r.idx,
        r.playCount || "",
        r.clear || ""
      ].join("\t"))
    );

    return lines.join("\n");
  }

  function showOverlay(tsv) {
    const old = document.getElementById("chuni-tsv-overlay");
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.id = "chuni-tsv-overlay";
    Object.assign(wrap.style,{
      position:"fixed",inset:"0",
      background:"rgba(0,0,0,0.85)",
      zIndex:"99999",
      display:"flex",flexDirection:"column",
      padding:"12px",boxSizing:"border-box"
    });

    const info = document.createElement("div");
    info.textContent = "（送信できない場合）長押し → 全選択 → コピー";
    Object.assign(info.style,{ color:"#fff",fontSize:"12px",marginBottom:"8px" });

    const ta = document.createElement("textarea");
    ta.value = tsv;
    Object.assign(ta.style,{
      flex:"1",width:"100%",color:"#fff",
      background:"#111827",
      fontSize:"11px",
      border:"1px solid #4b5563",
      borderRadius:"6px"
    });

    const btn = document.createElement("button");
    btn.textContent = "閉じる";
    Object.assign(btn.style,{
      marginTop:"8px",alignSelf:"flex-end",
      padding:"6px 12px",
      borderRadius:"999px",border:"none",
      background:"#4f46e5",color:"#fff"
    });
    btn.onclick = () => wrap.remove();

    wrap.appendChild(info);
    wrap.appendChild(ta);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);

    ta.focus();
    ta.select();
  }

  function showProgressOverlay(total) {
    const old = document.getElementById("chuni-progress-overlay");
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.id = "chuni-progress-overlay";

    Object.assign(wrap.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(15,23,42,0.65)",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    });

    wrap.innerHTML = `
      <div style="
        background:#111827;
        color:white;
        padding:28px 36px;
        font-size:24px;
        font-weight:bold;
        border-radius:16px;
        border:1px solid rgba(255,255,255,0.12);
        box-shadow:0 12px 40px rgba(0,0,0,0.35);
      ">
        <div style="margin-bottom:8px;">プレイ回数取得中...</div>
        <div id="chuni-progress-text">
          0 / ${total}
        </div>
      </div>
    `;

    document.documentElement.appendChild(wrap);
  }

  function updateProgressOverlay(done, total) {
    const el = document.getElementById("chuni-progress-text");
    if (el) {
      el.textContent = `${done} / ${total} (${Math.floor(done * 100 / total)}%)`;
    }
  }

  function hideProgressOverlay() {
    const el = document.getElementById("chuni-progress-overlay");
    if (el) el.remove();
  }

  if (location.host.indexOf("chunithm-net") === -1) {
    alert("CHUNITHM-NET 上で実行してください！");
    return;
  }

  const doJump = true;

  Promise.all(
    PAGES.map(p =>
      fetchDoc(BASE + p.path).then(doc => scrape(doc, p.frame))
    )
  )
    .then(async arr => {
      const results = arr.flat();

      if (!results.length) {
        alert("データを取得できませんでした");
        return;
      }

      const firstDoc = await fetchDoc(BASE + PAGES[0].path);
      const token = extractToken(firstDoc);

      let playerName = String(extractPlayerName(document) || "");
      try {
        const homeDoc = await fetchDoc(location.origin + "/chuni-mobile/html/mobile/home/");
        playerName = String(extractPlayerName(homeDoc) || playerName || "");
      } catch (e) {
        console.warn("プレイヤー名取得用のhome取得に失敗しました:", e.message || e);
      }

      if (!token) {
        alert("tokenを取得できませんでした。プレイ回数なしでTSVを出力します。");
      } else {
        await hydratePlayCounts(results, token);
      }

      const tsv = buildTsv(results, playerName);

      if (doJump) {
        const encoded = encodeURIComponent(tsv);
        const encodedPlayerName = encodeURIComponent(playerName || "");
        location.href = RECEIVER_URL + "#playerName=" + encodedPlayerName + "&tsv=" + encoded;
        return;
      }

      showOverlay(tsv);
      console.log(tsv);
    })
    .catch(err => alert("取得エラー: " + err));
})();
