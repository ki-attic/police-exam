/* ===== 本機儲存:錯題記錄 + 作答統計(localStorage) ===== */
window.Store = (function(){
  var KEY = 'pe_wrong_v1';   // { bankId: { mcq:[idx...], cloze:[idx...] } }
  var SKEY = 'pe_stats_v1';  // { answered, correct }

  function read(k, def){ try { return JSON.parse(localStorage.getItem(k)) || def; } catch(e){ return def; } }
  function write(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }

  function getAll(){ return read(KEY, {}); }

  function markWrong(bankId, kind, idx){
    var w = getAll();
    w[bankId] = w[bankId] || { mcq:[], cloze:[] };
    var arr = w[bankId][kind] || (w[bankId][kind] = []);
    if(arr.indexOf(idx) < 0) arr.push(idx);
    write(KEY, w);
  }

  // 答對則視為已熟練,從錯題中移除
  function markCorrect(bankId, kind, idx){
    var w = getAll();
    if(w[bankId] && w[bankId][kind]){
      var i = w[bankId][kind].indexOf(idx);
      if(i >= 0){
        w[bankId][kind].splice(i, 1);
        if(!w[bankId].mcq.length && !w[bankId].cloze.length) delete w[bankId];
        write(KEY, w);
      }
    }
  }

  function bankWrong(bankId){ var w = getAll(); return w[bankId] || { mcq:[], cloze:[] }; }
  function bankWrongCount(bankId){ var b = bankWrong(bankId); return (b.mcq||[]).length + (b.cloze||[]).length; }
  function totalWrong(){ var w = getAll(), n = 0; for(var k in w){ n += (w[k].mcq||[]).length + (w[k].cloze||[]).length; } return n; }

  function clear(bankId){
    if(bankId){ var w = getAll(); delete w[bankId]; write(KEY, w); }
    else write(KEY, {});
  }

  function recordAnswer(correct){
    var s = read(SKEY, { answered:0, correct:0 });
    s.answered++; if(correct) s.correct++;
    write(SKEY, s);
  }
  function stats(){ return read(SKEY, { answered:0, correct:0 }); }

  return { getAll:getAll, markWrong:markWrong, markCorrect:markCorrect,
           bankWrong:bankWrong, bankWrongCount:bankWrongCount, totalWrong:totalWrong,
           clear:clear, recordAnswer:recordAnswer, stats:stats };
})();
