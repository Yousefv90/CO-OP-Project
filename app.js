/* =====================================================
   نظام إجازات الفريق - الإعدادات وطبقة البيانات والدخول
   ===================================================== */
/* eslint-disable no-undef */

// الإعدادات (Firebase و EmailJS) أصبحت في ملف منفصل: config.js
// ضع مفاتيحك هناك مرة واحدة فقط - لا تعد نسخها هنا أبداً

// ====== الفرق ======
const TEAMS = ["التقنية", "المبيعات", "الموارد البشرية", "التمويل", "التسويق"];

// ====== رصيد الإجازات ======
const BALANCE = { annual: 30, sick: 30 };

// ====== قراءة الإعدادات من config.js بأمان ======
// لو فيه خطأ في config.js (مثل سطر initializeApp زائد) ما يطيح الموقع كامل
let fbCfg = null, mailCfg = null;
try { fbCfg = firebaseConfig; } catch (e) { fbCfg = null; }
try { mailCfg = emailjsConfig; } catch (e) { mailCfg = null; }
if (!fbCfg || !mailCfg) {
  alert("تنبيه: ملف config.js فيه خطأ أو ناقص.\nلازم يحتوي فقط على firebaseConfig و emailjsConfig بدون أي سطر إضافي مثل initializeApp");
}

// ====== اكتشاف الوضع تلقائياً ======
const isFilled = (cfg) => !!cfg && !Object.values(cfg).some(v => String(v).startsWith("PASTE"));
const useFirebase = isFilled(fbCfg);
const emailReady = isFilled(mailCfg);
let db = null;

if (useFirebase) {
  firebase.initializeApp(fbCfg);
  db = firebase.firestore();
}
if (emailReady) {
  emailjs.init({ publicKey: mailCfg.publicKey });
}

/* ================== طبقة البيانات ================== */

async function getAllUsers() {
  if (useFirebase) {
    const snap = await db.collection("users").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return JSON.parse(localStorage.getItem("lv_users") || "[]");
}

async function findUserByName(name) {
  const users = await getAllUsers();
  return users.find(u => (u.name || "").toLowerCase() === name.trim().toLowerCase());
}

async function findUserByLogin(id) {
  const users = await getAllUsers();
  const key = id.trim().toLowerCase();
  return users.find(u => (u.email || "").toLowerCase() === key || (u.name || "").toLowerCase() === key);
}

async function saveUser(user) {
  if (useFirebase) {
    await db.collection("users").add(user);
  } else {
    if (!user.id) user.id = user.email;
    const users = await getAllUsers();
    users.push(user);
    localStorage.setItem("lv_users", JSON.stringify(users));
  }
}

// تحديث صلاحية مستخدم (من شاشة الإدارة)
async function updateUserRole(user, newRole) {
  if (useFirebase) {
    await db.collection("users").doc(user.id).update({ role: newRole });
  } else {
    const users = JSON.parse(localStorage.getItem("lv_users") || "[]");
    const i = users.findIndex(u => String(u.id || u.email).toLowerCase() === String(user.id || user.email).toLowerCase());
    if (i > -1) {
      users[i].role = newRole;
      localStorage.setItem("lv_users", JSON.stringify(users));
    }
  }
  // لو الأدمن غيّر صلاحيته هو نفسه نحدّث القائمة فوراً
  if (currentUser && (currentUser.email || "").toLowerCase() === (user.email || "").toLowerCase()) {
    currentUser.role = newRole;
    $("approvalsNav").style.display = newRole === "manager" || newRole === "admin" ? "inline-block" : "none";
    $("adminNav").style.display = newRole === "admin" ? "inline-block" : "none";
  }
}

/* ====== الإجازات + التحديث اللحظي (Realtime) ======
   مع الفايربيس: أي تغيير (طلب جديد، موافقة، رفض) يوصل لكل الأجهزة
   المفتوحة فوراً بدون تحديث الصفحة.
   في الوضع التجريبي (بدون فايربيس): التحديث يتم بعد كل عملية كالمعتاد. */
let leavesCache = [];
let leavesUnsub = null;

function getAllLeaves() {
  return leavesCache;
}

// تشغيل الاستماع اللحظي على مجموعة الإجازات
function startLeavesListener() {
  if (!useFirebase) {
    leavesCache = JSON.parse(localStorage.getItem("lv_leaves") || "[]");
    return;
  }
  if (leavesUnsub) leavesUnsub();
  leavesUnsub = db.collection("leaves").orderBy("created_at", "desc")
    .onSnapshot(snap => {
      leavesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      onLeavesChanged();
    }, err => {
      alert("تعذر قراءة الإجازات من Firebase: " + err.message +
        "\nتأكد أن قواعد Firestore (Rules) تسمح بالقراءة والكتابة");
    });
}

function stopLeavesListener() {
  if (leavesUnsub) { leavesUnsub(); leavesUnsub = null; }
  leavesCache = [];
}

// إعادة رسم الشاشات المعتمدة على الإجازات عند أي تغيير
function onLeavesChanged() {
  if (typeof loadMyLeaves === "function") loadMyLeaves();
  const active = document.querySelector(".nav-btn.active");
  if (active && active.dataset.sec === "calendar" && typeof renderCalendar === "function") renderCalendar();
  if (active && active.dataset.sec === "approvals" && typeof renderApprovals === "function") renderApprovals();
}

async function saveLeave(leave) {
  leave.created_at = new Date().toISOString();
  if (useFirebase) {
    await db.collection("leaves").add(leave);
  } else {
    const leaves = getAllLeaves();
    leave.id = Date.now();
    leaves.push(leave);
    localStorage.setItem("lv_leaves", JSON.stringify(leaves));
    onLeavesChanged();
  }
}

async function updateLeave(id, patch) {
  if (useFirebase) {
    await db.collection("leaves").doc(String(id)).update(patch);
  } else {
    const leaves = getAllLeaves();
    const i = leaves.findIndex(l => String(l.id) === String(id));
    if (i > -1) {
      Object.assign(leaves[i], patch);
      localStorage.setItem("lv_leaves", JSON.stringify(leaves));
      onLeavesChanged();
    }
  }
}

async function deleteLeave(id) {
  if (useFirebase) {
    await db.collection("leaves").doc(String(id)).delete();
  } else {
    leavesCache = leavesCache.filter(l => String(l.id) !== String(id));
    localStorage.setItem("lv_leaves", JSON.stringify(leavesCache));
    onLeavesChanged();
  }
}

// إرسال رمز التحقق إلى البريد
// نرسل البريد باسمين (email و to_email) حتى يشتغل مع أي إعداد في خانة To Email بقالب EmailJS
async function sendOtpEmail(email, name, code) {
  if (!emailReady) throw new Error("إعدادات EmailJS غير موجودة في config.js");
  await emailjs.send(mailCfg.serviceId, mailCfg.templateId, {
    email: email, to_email: email, name: name, to_name: name, passcode: code
  });
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
let otpMode = null; // "register" = حساب جديد، "login" = تسجيل دخول

// إظهار أي خطأ غير متوقع (مثل رفض Firebase) بدل ما يفشل الزر بصمت
window.addEventListener("unhandledrejection", (e) => {
  alert("حدث خطأ: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
});

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

  // أول مستخدم يفتح النظام بدون أدمن يصير أدمن تلقائياً
  const existingUsers = await getAllUsers();
  const hasAdmin = existingUsers.some(u => u.role === "admin");
  pendingUser = { name, email, team, password, role: hasAdmin ? "member" : "admin", verified: false };
  otpMode = "register";

  await startOtpFlow(email, name);
});

// توليد الرمز وإرساله بالبريد (تسجيل جديد أو تسجيل دخول)
// الرمز يُرسل بالبريد فقط - لا يوجد وضع تجريبي
async function startOtpFlow(email, name) {
  pendingOtp = null;
  $("otpError").textContent = "";
  $("otpHint").textContent = "جاري إرسال الرمز إلى " + email;
  $("otpSending").style.display = "block";
  showScreen("otp");

  const code = String(Math.floor(100000 + Math.random() * 900000));
  try {
    await sendOtpEmail(email, name, code);
    pendingOtp = code;
    $("otpHint").textContent = "أدخل الرمز المكون من 6 أرقام المرسل إلى " + email;
  } catch (err) {
    // نعرض سبب الفشل الحقيقي من EmailJS
    $("otpError").textContent = "تعذر إرسال الرمز: " + (err.text || err.message || err) + " - اضغط إعادة إرسال الرمز";
  }
  $("otpSending").style.display = "none";
}

/* ===== التحقق من الرمز ===== */

$("otpVerifyBtn").addEventListener("click", async () => {
  $("otpError").textContent = "";
  if (!pendingOtp || $("otpInput").value.trim() !== pendingOtp) { $("otpError").textContent = "الرمز غير صحيح"; return; }

  $("otpInput").value = "";
  // عند التسجيل الجديد نحفظ الحساب، وعند تسجيل الدخول الحساب محفوظ مسبقاً
  if (otpMode === "register") {
    otpMode = null;
    pendingUser.verified = true;
    await saveUser({ ...pendingUser, created_at: new Date().toISOString() });
  }
  enterApp(pendingUser);
});

// إعادة الإرسال: رمز جديد يُرسل للبريد
$("otpResendBtn").addEventListener("click", () => startOtpFlow(pendingUser.email, pendingUser.name));

/* ===== تسجيل الدخول ===== */

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").textContent = "";

  const user = await findUserByLogin($("loginName").value);
  if (!user || user.password !== $("loginPassword").value) {
    $("loginError").textContent = "بيانات الدخول غير صحيحة";
    return;
  }
  // تسجيل الدخول يتطلب رمز تحقق أيضاً
  pendingUser = user;
  otpMode = "login";
  await startOtpFlow(user.email, user.name);
});

/* ===== الجلسة والدخول للتطبيق ===== */

function enterApp(user) {
  currentUser = user;
  localStorage.setItem("lv_session", user.email || user.name);
  $("userChip").textContent = "أهلاً، " + user.name + " (" + user.team + ")";
  const isManager = user.role === "manager" || user.role === "admin" || !useFirebase;
  $("approvalsNav").style.display = isManager ? "inline-block" : "none";
  $("adminNav").style.display = user.role === "admin" ? "inline-block" : "none";
  showScreen("app");
  startLeavesListener();
  if (window.systemInit) systemInit();
}

$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("lv_session");
  stopLeavesListener();
  currentUser = null;
  showScreen("auth");
});

// الجلسة لا تُستعاد: كل مرة يفتح فيها المستخدم الموقع يطلب تسجيل دخول من جديد