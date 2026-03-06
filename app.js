const firebaseConfig = {
  apiKey: "AIzaSyAMSTMSJXaRxqljMnUiQ_bmT_y89SXkS9A",
  authDomain: "p2pchat-bea11.firebaseapp.com",
  projectId: "p2pchat-bea11",
  storageBucket: "p2pchat-bea11.firebasestorage.app",
  messagingSenderId: "621690689501",
  appId: "1:621690689501:web:6f5f61463dcf98adc00834"
};


firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

let activeChatId = null, msgListener = null, pc = null, localStream = null;
const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function navigateTo(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.getElementById(id).classList.add('active-screen');
}

// 1. AUTH
auth.onAuthStateChanged(async (user) => {
    if (user) {
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists) { navigateTo('contact-page'); loadContacts(); listenForCalls(); }
        else { navigateTo('setup-screen'); }
    } else { navigateTo('auth-screen'); }
});

document.getElementById('login-btn').onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());

document.getElementById('save-profile').onclick = async () => {
    const cid = document.getElementById('custom-id').value.toLowerCase().trim();
    const name = document.getElementById('display-name').value;
    if(!cid || !name) return alert("Required!");
    await db.collection('users').doc(auth.currentUser.uid).set({ uid: auth.currentUser.uid, customId: cid, name: name });
    navigateTo('contact-page');
};

// 2. CONTACTS
function loadContacts() {
    db.collection('users').doc(auth.currentUser.uid).collection('contacts').onSnapshot(snap => {
        const list = document.getElementById('contact-list');
        list.innerHTML = '';
        snap.forEach(doc => {
            const u = doc.data();
            const div = document.createElement('div');
            div.className = 'contact-item';
            div.innerHTML = `<strong>${u.name}</strong><br><small>@${u.customId}</small>`;
            div.onclick = () => openChat(u);
            list.appendChild(div);
        });
    });
}

// Search Logic
document.getElementById('user-search').onkeypress = async (e) => {
    if (e.key === 'Enter') {
        const val = e.target.value.toLowerCase().trim();
        const snap = await db.collection('users').where('customId', '==', val).get();
        const overlay = document.getElementById('search-result-overlay');
        overlay.classList.remove('hidden');
        if (snap.empty) { document.getElementById('found-user-info').innerText = "NOT_FOUND"; }
        else { 
            const foundUser = snap.docs[0].data();
            document.getElementById('found-user-info').innerText = foundUser.name;
            document.getElementById('add-contact-btn').onclick = async () => {
                const me = (await db.collection('users').doc(auth.currentUser.uid).get()).data();
                await db.collection('users').doc(auth.currentUser.uid).collection('contacts').doc(foundUser.uid).set(foundUser);
                await db.collection('users').doc(foundUser.uid).collection('contacts').doc(auth.currentUser.uid).set(me);
                overlay.classList.add('hidden');
            };
        }
    }
};

document.getElementById('close-search').onclick = () => document.getElementById('search-result-overlay').classList.add('hidden');

// 3. CHAT & EMOJIS
function openChat(target) {
    if(msgListener) msgListener();
    activeChatId = [auth.currentUser.uid, target.uid].sort().join('_');
    document.getElementById('target-name').innerText = target.name;
    navigateTo('chat-page');
    document.getElementById('message-flow').innerHTML = '';
    
    msgListener = db.collection('chats').doc(activeChatId).collection('messages')
        .orderBy('timestamp','asc').onSnapshot(s => {
            s.docChanges().forEach(c => { if(c.type === "added") renderMsg(c.doc.data()); });
        });
}

function renderMsg(m) {
    const d = document.createElement('div');
    d.className = `msg ${m.senderId === auth.currentUser.uid ? 'sent' : 'rcvd'}`;
    d.innerHTML = m.type === 'image' ? `<img src="${m.fileUrl}" onclick="window.open('${m.fileUrl}')">` : m.text;
    const flow = document.getElementById('message-flow');
    flow.appendChild(d); flow.scrollTop = flow.scrollHeight;
}

// Emoji Picker Logic
document.getElementById('emoji-btn').onclick = (e) => {
    e.stopPropagation();
    document.getElementById('emoji-picker').classList.toggle('hidden');
};

document.querySelectorAll('.emoji-item').forEach(e => {
    e.onclick = () => {
        document.getElementById('msg-input').value += e.innerText;
        document.getElementById('emoji-picker').classList.add('hidden');
        document.getElementById('msg-input').focus();
    };
});

document.addEventListener('click', () => document.getElementById('emoji-picker').classList.add('hidden'));

// Send Logic
document.getElementById('send-btn').onclick = () => {
    const txt = document.getElementById('msg-input').value;
    if(!txt) return;
    db.collection('chats').doc(activeChatId).collection('messages').add({
        senderId: auth.currentUser.uid, text: txt, timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('msg-input').value = '';
};

// 4. CALLING (WEBRTC)

document.getElementById('trigger-call').onclick = async () => {
    pc = new RTCPeerConnection(iceServers);
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('local-video').srcObject = localStream;
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    pc.ontrack = e => document.getElementById('remote-video').srcObject = e.streams[0];
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await db.collection('calls').doc(activeChatId).set({ offer, status: 'ringing' });
    document.getElementById('call-overlay').classList.remove('hidden');
};

function listenForCalls() {
    db.collection('calls').onSnapshot(snap => {
        snap.docChanges().forEach(async c => {
            const data = c.doc.data();
            if(data?.status === 'ringing' && c.doc.id.includes(auth.currentUser.uid)) {
                document.getElementById('incoming-call-box').classList.remove('hidden');
                document.getElementById('accept-btn').onclick = () => acceptCall(data.offer, c.doc.id);
                document.getElementById('reject-btn').onclick = () => db.collection('calls').doc(c.doc.id).delete();
            }
            if(data?.answer && pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        });
    });
}

async function acceptCall(offer, id) {
    document.getElementById('incoming-call-box').classList.add('hidden');
    document.getElementById('call-overlay').classList.remove('hidden');
    pc = new RTCPeerConnection(iceServers);
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('local-video').srcObject = localStream;
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    pc.ontrack = e => document.getElementById('remote-video').srcObject = e.streams[0];
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await db.collection('calls').doc(id).update({ answer, status: 'connected' });
}

document.getElementById('hangup-btn').onclick = () => {
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    document.getElementById('call-overlay').classList.add('hidden');
    db.collection('calls').doc(activeChatId).delete();
};

document.getElementById('back-to-contacts').onclick = () => navigateTo('contact-page');

// Matrix logic...
const can = document.getElementById('matrix-canvas');
const ctx = can.getContext('2d');
can.width = window.innerWidth; can.height = window.innerHeight;
const drops = Array(Math.floor(can.width/14)).fill(1);
function draw() {
    ctx.fillStyle = "rgba(0,0,0,0.05)"; ctx.fillRect(0,0,can.width,can.height);
    ctx.fillStyle = "#0F0";
    drops.forEach((y, i) => {
        ctx.fillText(String.fromCharCode(0x30A0+Math.random()*96), i*14, y*14);
        if(y*14 > can.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
    });
}
setInterval(draw, 50);

