/* 題庫清單。law:true = 含可閱讀法條(歸到「法條」);其餘為考古題(歸到「測驗題複習」,依 subject 混合各年) */
window.EXAM_MANIFEST = [
  { id: "police-power", name: "警察職權行使法", subject: "警察法規", file: "data/police-power.js", law: true },
  { id: "law-police-act", name: "警察法", subject: "警察法規", file: "data/law-police-act.js", law: true },
  { id: "law-admin-exec", name: "行政執行法", subject: "警察法規", file: "data/law-admin-exec.js", law: true },
  { id: "law-social-order", name: "社會秩序維護法", subject: "警察法規", file: "data/law-social-order.js", law: true },
  { id: "law-guns", name: "槍砲彈藥刀械管制條例", subject: "警察法規", file: "data/law-guns.js", law: true },
  { id: "law-assembly", name: "集會遊行法", subject: "警察法規", file: "data/law-assembly.js", law: true },
  { id: "law-weapon-use", name: "警械使用條例", subject: "警察法規", file: "data/law-weapon-use.js", law: true },

  { id: "law-pastexams", name: "警察法規 考古題·108年", subject: "警察法規", file: "data/law-pastexams.js" },
  { id: "pastexam-110", name: "警察法規 考古題·110年", subject: "警察法規", file: "data/pastexam-110.js" },
  { id: "pastexam-111", name: "警察法規 考古題·111年", subject: "警察法規", file: "data/pastexam-111.js" },
  { id: "pastexam-112", name: "警察法規 考古題·112年", subject: "警察法規", file: "data/pastexam-112.js" },
  { id: "pastexam-113", name: "警察法規 考古題·113年", subject: "警察法規", file: "data/pastexam-113.js" },
  { id: "pastexam-114", name: "警察法規 考古題·114年", subject: "警察法規", file: "data/pastexam-114.js" },

  { id: "lk-111", name: "法學知識與英文 考古題·111年", subject: "法學知識與英文", file: "data/lk-111.js" },
  { id: "lk-112", name: "法學知識與英文 考古題·112年", subject: "法學知識與英文", file: "data/lk-112.js" },
  { id: "lk-113", name: "法學知識與英文 考古題·113年", subject: "法學知識與英文", file: "data/lk-113.js" },
  { id: "lk-114", name: "法學知識與英文 考古題·114年", subject: "法學知識與英文", file: "data/lk-114.js" },

  { id: "admin-111", name: "行政法 考古題·111年", subject: "行政法", file: "data/admin-111.js" },
  { id: "admin-112", name: "行政法 考古題·112年", subject: "行政法", file: "data/admin-112.js" },
  { id: "admin-113", name: "行政法 考古題·113年", subject: "行政法", file: "data/admin-113.js" },
  { id: "admin-114", name: "行政法 考古題·114年", subject: "行政法", file: "data/admin-114.js" },

  { id: "vocab-1", name: "警察英文單字 (1)", subject: "英文", file: "data/vocab-1.js" },

  { id: "quotes-1", name: "名言佳句", subject: "國文", file: "data/quotes-1.js", law: true }
];
