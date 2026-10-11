/* =====================================================
   نظام إجازات الفريق - الإعدادات وطبقة البيانات والدخول
   ===================================================== */

// ====== 1) إعدادات Firebase (قاعدة البيانات NoSQL) ======
const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

// ====== 2) إعدادات البريد (لإرسال رمز التحقق للإيميل) ======
const emailjsConfig = {
  serviceId: "service_8zoimoj",
  templateId: "template_3b1d8fa",
  publicKey: "hjG9xad9xyU4S-Hh7"
};

// ====== الفرق ======
const TEAMS = ["التقنية", "المبيعات", "الموارد البشرية", "التمويل", "التسويق"];

// ====== رصيد الإجازات ======
const BALANCE = { annual: 30, sick: 30 };

// ====== اكتشاف الوضع تلقائياً ======
const useFirebase = !Object.values(firebaseConfig).some(v => v.startsWith("PASTE"));
const emailReady = !Object.values(emailjsConfig).some(v => v.startsWith("PASTE"));
let db = null;

if (useFirebase) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
}
if (emailReady) {
  emailjs.init({ publicKey: emailjsConfig.publicKey });
}

/* ================== طبقة البيانات ================== */

async function getAllUsers() {
  if (useFirebase) {
    const snap = await db.collection("users").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  const users = JSON.parse(localStorage.getItem("lv_users") || "[]");
  let changed = false;
  users.forEach((u, i) => { if (!u.id) { u.id = "u" + Date.now() + "_" + i; changed = true; } });
  if (changed) localStorage.setItem("lv_users", JSON.stringify(users));
  return users;
}

// تحديث بيانات مستخدم (مثلاً تغيير الدور)
async function updateUser(id, patch) {
  if (useFirebase) {
    await db.collection("users").doc(String(id)).update(patch);
  } else {
    const users = await getAllUsers();
    const u = users.find(x => String(x.id) === String(id));
    if (u) { Object.assign(u, patch); localStorage.setItem("lv_users", JSON.stringify(users)); }
  }
}

async function findUserByName(name) {
  const users = await getAllUsers();
  return users.find(u => u.name.toLowerCase() === name.trim().toLowerCase());
}

async function findUserByLogin(id) {
  const users = await getAllUsers();
  const key = id.trim().toLowerCase();
  return users.find(u => u.email.toLowerCase() === key || u.name.toLowerCase() === key);
}

async function saveUser(user) {
  if (useFirebase) {
    await db.collection("users").add(user);
  } else {
    const users = await getAllUsers();
    users.push(user);
    localStorage.setItem("lv_users", JSON.stringify(users));
  }
}

// الإجازات
async function getAllLeaves() {
  if (useFirebase) {
    const snap = await db.collection("leaves").orderBy("created_at", "desc").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return JSON.parse(localStorage.getItem("lv_leaves") || "[]");
}

async function saveLeave(leave) {
  leave.created_at = new Date().toISOString();
  if (useFirebase) {
    await db.collection("leaves").add(leave);
  } else {
    const leaves = await getAllLeaves();
    leave.id = Date.now();
    leaves.push(leave);
    localStorage.setItem("lv_leaves", JSON.stringify(leaves));
  }
}

async function updateLeave(id, patch) {
  if (useFirebase) {
    await db.collection("leaves").doc(String(id)).update(patch);
  } else {
    const leaves = await getAllLeaves();
    const i = leaves.findIndex(l => String(l.id) === String(id));
    if (i > -1) { Object.assign(leaves[i], patch); localStorage.setItem("lv_leaves", JSON.stringify(leaves)); }
  }
}

async function deleteLeave(id) {
  if (useFirebase) {
    await db.collection("leaves").doc(String(id)).delete();
  } else {
    const leaves = await getAllLeaves();
    localStorage.setItem("lv_leaves", JSON.stringify(leaves.filter(l => String(l.id) !== String(id))));
  }
}

// إرسال رمز التحقق إلى البريد
async function sendOtpEmail(email, name, code) {
  if (!emailReady) return false;
  await emailjs.send(emailjsConfig.serviceId, emailjsConfig.templateId, {
    email: email, to_name: name, passcode: code
  });
  return true;
}

/* ================== كلمة المرور ================== */

function passwordIssues(p) {
  const issues = [];
  if (p.length < 8) issues.push("ruleLen");
  if (!/[A-Z]/.test(p)) issues.push("ruleUpper");
  if (!/[a-z]/.test(p)) issues.push("ruleLower");
  if (!/[^A-Za-z0-9]/.test(p)) issues.push("ruleSpecial");
  return issues;
}

/* ================== الواجهة والدخول ================== */

const $ = (id) => document.getElementById(id);
let currentUser = null;
let pendingUser = null;
let pendingOtp = null;
let otpMode = "register";

function showScreen(name) {
  $("authScreen").style.display = name === "auth" ? "flex" : "none";
  $("otpScreen").style.display = name === "otp" ? "flex" : "none";
  $("appScreen").style.display = name === "app" ? "block" : "none";
}

// تعبئة قائمة الفرق
$("regTeam").innerHTML = TEAMS.map(t => `<option value="${t}">${t}</option>`).join("");

// التبويبات
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    $("loginForm").style.display = tab.dataset.tab === "login" ? "block" : "none";
    $("registerForm").style.display = tab.dataset.tab === "register" ? "block" : "none";
  });
});

// مؤشر قوة كلمة المرور
$("regPassword").addEventListener("input", (e) => {
  const bad = passwordIssues(e.target.value);
  ["ruleLen", "ruleUpper", "ruleLower", "ruleSpecial"].forEach(r =>
    $(r).classList.toggle("ok", !bad.includes(r)));
});

/* ===== إنشاء حساب ===== */

$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("regError").textContent = "";

  const name = $("regName").value.trim();
  const email = $("regEmail").value.trim();
  const team = $("regTeam").value;
  const password = $("regPassword").value;
  const confirm = $("regConfirm").value;

  if (password !== confirm) { $("regError").textContent = "كلمة المرور غير متطابقة"; return; }
  if (passwordIssues(password).length > 0) { $("regError").textContent = "كلمة المرور لا تحقق الشروط"; return; }

  // منع تكرار الاسم
  const dup = await findUserByName(name);
  if (dup) { $("regError").textContent = "الاسم مستخدم مسبقاً، اختر اسماً آخر"; return; }

  // أول مستخدم في قاعدة البيانات يصبح مدير عام تلقائياً
  const existing = await getAllUsers();
  const role = (existing.length === 0) ? "admin" : "member";
  pendingUser = { name, email, team, password, role, verified: false };

  await startOtp(pendingUser, "register");
});

/* ===== إرسال رمز التحقق (تسجيل أو دخول) ===== */

async function startOtp(user, mode) {
  otpMode = mode;
  pendingUser = user;
  pendingOtp = String(Math.floor(100000 + Math.random() * 900000));
  $("otpSending").style.display = "block";

  let sent = false, sendErr = "";
  try { sent = await sendOtpEmail(user.email, user.name, pendingOtp); }
  catch (err) { sent = false; sendErr = (err && (err.text || err.message)) ? String(err.text || err.message) : "خطأ غير معروف"; }

  $("otpSending").style.display = "none";
  $("otpHint").textContent = "أدخل الرمز المكون من 6 أرقام المرسل إلى " + user.email;
  if (!sent) {
    // فشل الإرسال بالبريد - نعرض السبب فقط ويمكن إعادة المحاولة
    $("otpHint").textContent = "تعذر إرسال الرمز إلى بريدك (السبب: " + sendErr + ") - جرّب إعادة إرسال الرمز";
  }
  showScreen("otp");
}

/* ===== التحقق من الرمز ===== */

$("otpVerifyBtn").addEventListener("click", async () => {
  $("otpError").textContent = "";
  if ($("otpInput").value !== pendingOtp) { $("otpError").textContent = "الرمز غير صحيح"; return; }

  $("otpInput").value = "";
  if (otpMode === "register") {
    pendingUser.verified = true;
    await saveUser({ ...pendingUser, created_at: new Date().toISOString() });
  }
  enterApp(pendingUser);
});

$("otpResendBtn").addEventListener("click", async () => { await startOtp(pendingUser, otpMode); });

/* ===== تسجيل الدخول ===== */

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").textContent = "";

  const user = await findUserByLogin($("loginName").value);
  if (!user || user.password !== $("loginPassword").value) {
    $("loginError").textContent = "بيانات الدخول غير صحيحة";
    return;
  }
  // رمز تحقق على البريد قبل الدخول
  await startOtp(user, "login");
});

/* ===== الجلسة والدخول للتطبيق ===== */

function enterApp(user) {
  currentUser = user;
  $("userChip").textContent = "أهلاً، " + user.name + " (" + user.team + ")";
  const isManager = user.role === "manager" || user.role === "admin";
  $("approvalsNav").style.display = isManager ? "inline-block" : "none";
  const adminNavBtn = $("adminNav");
  if (adminNavBtn) adminNavBtn.style.display = (user.role === "admin") ? "inline-block" : "none";
  showScreen("app");
  if (window.systemInit) systemInit();
}

$("logoutBtn").addEventListener("click", () => {
  currentUser = null;
  showScreen("auth");
});
