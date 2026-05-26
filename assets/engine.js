/* ===== 共用測驗引擎 PE — 法規頁與總複習頁共用 ===== */
window.PE = (function(){
  var esc = function(s){ return String(s).replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); };
  var shuffle = function(a){ a = a.slice(); for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; } return a; };

  /* 把一個題庫(bank)的題目轉成標準化題目陣列 */
  function mcqItems(bankId, bank, label){
    return (bank.mcq||[]).map(function(q, i){
      return { kind:'mcq', bankId:bankId, idx:i, label:label||'', ref:q.ref, q:q.q,
               options:q.options, answer:q.answer, explain:q.explain, quote:q.quote };
    });
  }
  function clozeItems(bankId, bank, label){
    return (bank.cloze||[]).map(function(q, i){
      return { kind:'cloze', bankId:bankId, idx:i, label:label||'', ref:q.ref, text:q.text,
               answer:q.answer, options:q.options, explain:q.explain, quote:q.quote };
    });
  }
  /* 依錯題清單(Store)取出對應題目 */
  function wrongItems(bankId, bank, label){
    var w = Store.bankWrong(bankId), out = [];
    (w.mcq||[]).forEach(function(i){ if(bank.mcq && bank.mcq[i]){ var q=bank.mcq[i]; out.push({kind:'mcq',bankId:bankId,idx:i,label:label||'',ref:q.ref,q:q.q,options:q.options,answer:q.answer,explain:q.explain,quote:q.quote}); } });
    (w.cloze||[]).forEach(function(i){ if(bank.cloze && bank.cloze[i]){ var q=bank.cloze[i]; out.push({kind:'cloze',bankId:bankId,idx:i,label:label||'',ref:q.ref,text:q.text,answer:q.answer,options:q.options,explain:q.explain,quote:q.quote}); } });
    return out;
  }

  /* ---------- 法條閱讀 ---------- */
  function renderRead(view, articles){
    var html = '<input class="law-search" id="lawSearch" placeholder="🔍 搜尋條號或關鍵字(例:管束、三小時)">';
    var lastChap = '';
    (articles||[]).forEach(function(a){
      if(a.chapter && a.chapter !== lastChap){ html += '<div class="chapter">'+esc(a.chapter)+'</div>'; lastChap = a.chapter; }
      html += '<div class="article" data-text="'+esc('第'+a.no+'條 '+a.text)+'">'
            + '<div class="no">第 '+esc(a.no)+' 條</div>'
            + '<div class="body">'+esc(a.text)+'</div></div>';
    });
    view.innerHTML = html;
    var box = document.getElementById('lawSearch');
    box.addEventListener('input', function(){
      var kw = box.value.trim();
      var arts = view.querySelectorAll('.article');
      var chaps = view.querySelectorAll('.chapter');
      chaps.forEach(function(c){ c.style.display = kw ? 'none' : ''; });
      arts.forEach(function(el){
        var raw = el.getAttribute('data-text');
        var body = raw.replace(/^第[^條]+條 /,'');
        if(!kw){ el.classList.remove('hidden'); el.querySelector('.body').innerHTML = esc(body); return; }
        if(raw.indexOf(kw) >= 0){
          el.classList.remove('hidden');
          el.querySelector('.body').innerHTML = esc(body).split(esc(kw)).join('<mark>'+esc(kw)+'</mark>');
        } else { el.classList.add('hidden'); }
      });
    });
  }

  /* ---------- 通用測驗(一次一題) ---------- */
  var L = ['A','B','C','D','E','F'];
  function runQuiz(view, items, opts){
    opts = opts || {};
    if(!items || !items.length){ view.innerHTML = '<div class="empty">'+(opts.emptyMsg||'目前沒有題目。')+'</div>'; return; }
    var order = shuffle(items), pos = 0, score = 0, answered = false;

    function show(){
      if(pos >= order.length) return result();
      var q = order[pos], total = order.length;
      answered = false;
      var refLine = (q.label ? '<span style="color:var(--blue)">'+esc(q.label)+'</span> · ' : '') + (q.ref ? esc(q.ref) : '');
      var head = '<div class="quiz-head"><span>第 '+(pos+1)+' / '+total+' 題</span><span>答對 '+score+'</span></div>'
               + '<div class="progress"><i style="width:'+(pos/total*100)+'%"></i></div>';
      if(q.kind === 'mcq'){
        var h = head + '<div class="qcard">'
              + (refLine ? '<div class="qref">'+refLine+'</div>' : '')
              + '<div class="qtext">'+esc(q.q)+'</div><div id="opts">';
        q.options.forEach(function(o,i){ h += '<button class="opt" data-i="'+i+'"><span class="mk">'+L[i]+'</span><span>'+esc(o)+'</span></button>'; });
        h += '</div><div class="explain" id="explain"></div><button class="btn primary" id="nextBtn" style="display:none"></button></div>';
        view.innerHTML = h;
        view.querySelectorAll('.opt').forEach(function(b){ b.addEventListener('click', function(){ answerMcq(parseInt(b.dataset.i,10), q); }); });
      } else {
        var filled = esc(q.text).replace('【BLANK】','<span class="blank" id="blankSpan">？</span>');
        var h = head + '<div class="qcard">'
              + (refLine ? '<div class="qref">'+refLine+'</div>' : '')
              + '<div class="qtext">'+filled+'</div><div class="cloze-opts" id="chips">';
        shuffle(q.options).forEach(function(o){ h += '<button class="chip" data-v="'+esc(o)+'">'+esc(o)+'</button>'; });
        h += '</div><div class="explain" id="explain"></div><button class="btn primary" id="nextBtn" style="display:none"></button></div>';
        view.innerHTML = h;
        view.querySelectorAll('.chip').forEach(function(c){ c.addEventListener('click', function(){ answerCloze(c.dataset.v, q); }); });
      }
      var nb = document.getElementById('nextBtn');
      nb.textContent = (pos+1 >= order.length) ? '看成績 ›' : '下一題 ›';
      nb.addEventListener('click', function(){ pos++; show(); });
    }

    function finish(correct, q){
      answered = true;
      Store.recordAnswer(correct);
      if(correct) Store.markCorrect(q.bankId, q.kind, q.idx);
      else Store.markWrong(q.bankId, q.kind, q.idx);
      if(correct) score++;
      document.getElementById('nextBtn').style.display = 'block';
      if(opts.onChange) opts.onChange();
    }

    function answerMcq(i, q){
      if(answered) return;
      var opt = view.querySelectorAll('.opt');
      opt.forEach(function(b){ b.setAttribute('disabled','disabled'); });
      opt.forEach(function(b, idx){
        if(idx === q.answer) b.classList.add('correct');
        else if(idx === i) b.classList.add('wrong');
        else b.classList.add('dim');
      });
      var ex = document.getElementById('explain');
      ex.innerHTML = '<div class="lab">💡 詳解</div>'
        + '<div class="ans">正確答案:('+L[q.answer]+') '+esc(q.options[q.answer])+'</div>'
        + '<div style="margin-top:8px">'+esc(q.explain)+'</div>'
        + (q.quote ? '<div class="law-quote">'+esc(q.quote)+'</div>' : '');
      ex.classList.add('show');
      finish(i === q.answer, q);
    }

    function answerCloze(val, q){
      if(answered) return;
      var chips = view.querySelectorAll('.chip');
      chips.forEach(function(c){ c.setAttribute('disabled','disabled'); });
      var correct = (val === q.answer);
      chips.forEach(function(c){
        if(c.dataset.v === q.answer) c.classList.add('correct');
        else if(c.dataset.v === val) c.classList.add('wrong');
      });
      var bs = document.getElementById('blankSpan');
      if(bs){ bs.textContent = q.answer; bs.style.color = correct?'var(--green)':'var(--red)'; bs.style.borderColor = correct?'var(--green)':'var(--red)'; }
      var ex = document.getElementById('explain');
      ex.innerHTML = '<div class="lab">💡 詳解</div>'
        + '<div class="ans">正確答案:'+esc(q.answer)+'</div>'
        + '<div style="margin-top:8px">'+esc(q.explain)+'</div>'
        + (q.quote ? '<div class="law-quote">'+esc(q.quote)+'</div>' : '');
      ex.classList.add('show');
      finish(correct, q);
    }

    function result(){
      var pct = Math.round(score/order.length*100);
      var msg = pct>=90?'太強了!幾乎全對 🎉':pct>=70?'不錯,再加強錯題 💪':pct>=50?'及格邊緣,多練幾次 📖':'別氣餒,回去複習法條再來 ✊';
      view.innerHTML = '<div class="result"><div class="score">'+score+' / '+order.length+'</div>'
        + '<div class="msg">答對率 '+pct+'%</div><div class="msg">'+msg+'</div>'
        + '<button class="btn primary" id="again">再做一次(重新洗題)</button></div>';
      document.getElementById('again').addEventListener('click', function(){ order = shuffle(items); pos = 0; score = 0; show(); });
      if(opts.onChange) opts.onChange();
    }

    show();
  }

  /* ---------- 法規頁控制器(法條/選擇題/填空題/錯題) ---------- */
  function initLawPage(bankId){
    var bank = (window.BANKS||{})[bankId];
    var view = document.getElementById('view');
    if(!bank){ view.innerHTML = '<div class="empty">資料載入失敗。</div>'; return; }

    document.title = bank.meta.name;
    var nameEl = document.getElementById('lawName');
    if(nameEl) nameEl.childNodes[0].nodeValue = bank.meta.name;
    var metaEl = document.getElementById('lawMeta'); if(metaEl) metaEl.textContent = ' ' + (bank.meta.revised||'');
    var srcEl = document.getElementById('srcMeta'); if(srcEl) srcEl.textContent = (bank.meta.source||'');

    var tabs = document.querySelectorAll('.tabs button');
    function refreshWrongTab(){
      var t = document.querySelector('.tabs button[data-mode="wrong"]');
      if(t) t.textContent = '❗ 錯題 (' + Store.bankWrongCount(bankId) + ')';
    }
    var mode = 'read';
    function render(){
      refreshWrongTab();
      if(mode === 'read')  return renderRead(view, bank.articles);
      if(mode === 'mcq')   return runQuiz(view, mcqItems(bankId, bank), { onChange: refreshWrongTab });
      if(mode === 'cloze') return runQuiz(view, clozeItems(bankId, bank), { onChange: refreshWrongTab });
      if(mode === 'wrong') return runQuiz(view, wrongItems(bankId, bank), { onChange: refreshWrongTab, emptyMsg:'目前沒有錯題 🎉 答錯的題目會自動收進這裡,答對後移除。' });
    }
    tabs.forEach(function(b){
      b.addEventListener('click', function(){
        tabs.forEach(function(x){ x.classList.remove('active'); });
        b.classList.add('active'); mode = b.dataset.mode; render();
      });
    });
    render();
  }

  return { esc:esc, shuffle:shuffle, renderRead:renderRead, runQuiz:runQuiz,
           mcqItems:mcqItems, clozeItems:clozeItems, wrongItems:wrongItems, initLawPage:initLawPage };
})();
