// tsv-extractor.js
(() => {
  const DIFF = {0:"BAS",1:"ADV",2:"EXP",3:"MAS",4:"ULT"};
  const BASE = location.origin + "/chuni-mobile/html/mobile/home/playerData/";
  const PAGES = [
    { frame: "BEST", path: "ratingDetailBest/" },
    { frame: "NEW",  path: "ratingDetailRecent/" }
  ];

  const RECEIVER_URL = "https://sekasans.github.io/sekarate/";
  const RECEIVER_ORIGIN = "https://sekasans.github.io";

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
      const idx    = idxInput && idxInput.value ? idxInput.value : "";
      const diffId = diffInput && diffInput.value ? diffInput.value : "";
      const diff   = Object.prototype.hasOwnProperty.call(DIFF, diffId) ? DIFF[diffId] : diffId;

      if (title && score) rows.push({ frame, title, diff, score, idx });
    });
    return rows;
  }

  function fetchDoc(url) {
    return fetch(url, { credentials: "include" })
      .then(res => res.text())
      .then(html => new DOMParser().parseFromString(html, "text/html"));
  }

  function buildTsv(results) {
    const header = ["frame","title","diff","score","idx"];
    const lines = [header.join("\t")].concat(
      results.map(r => [r.frame, r.title, r.diff, r.score, r.idx].join("\t"))
    );
    return lines.join("\n");
  }

  // スマホ用の TSV 表示（保険：送信できなくてもコピペ可能）
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

  // ===== ここが超重要：同期で confirm→open =====
  if (location.host.indexOf("chunithm-net") === -1) {
    alert("CHUNITHM-NET 上で実行してください！");
    return;
  }

  const doJump = true;

  //const doJump = confirm(
  //  "レートビューアに移動してTSVを自動入力しますか？\n" +
  //  "（同一タブで開きます。戻るで戻れます）"
  //);

  // ここから非同期で取得してOK
  Promise.all(PAGES.map(p => fetchDoc(BASE + p.path).then(doc => scrape(doc, p.frame))))
    .then(arr => {
      const results = arr.flat();
      if (!results.length) {
        alert("データを取得できませんでした");
        return;
      }

      const tsv = buildTsv(results);

      if (doJump) {
        const encoded = encodeURIComponent(tsv);
        location.href = RECEIVER_URL + "#tsv=" + encoded;
        return;
      }

      // 送らない場合の保険
      showOverlay(tsv);
      console.log(tsv);
    })
    .catch(err => alert("取得エラー: " + err));
})();
