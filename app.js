const API_URL = "https://backendia-khz7.onrender.com";

let username = localStorage.getItem("username");

if(!username){

username = prompt("Ingresá tu nombre");

localStorage.setItem("username",username);

}

document.getElementById("username").innerText = "Usuario: "+username;

loadUsers();

loadMyHistory();

setInterval(loadUsers,5000);



async function sendMessage(){

const input = document.getElementById("message");

const message = input.value;

if(!message) return;

addMessage("user",message);

input.value="";

const loader = document.createElement("div");
loader.className="loader";
loader.innerText="IA escribiendo...";
document.getElementById("chat").appendChild(loader);

const res = await fetch(API_URL+"/chat",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
message:message,
user:username
})

});

const data = await res.json();

loader.remove();

addMessage("bot",data.reply);

}



function addMessage(type,text){

const chat = document.getElementById("chat");

const div = document.createElement("div");

div.className="message "+type;

div.innerText=text;

chat.appendChild(div);

chat.scrollTop=chat.scrollHeight;

}



async function loadUsers(){

const res = await fetch(API_URL+"/users");

const users = await res.json();

const list = document.getElementById("usersList");

list.innerHTML="";

users.forEach(u=>{

const div = document.createElement("div");

div.innerText=u;

div.onclick=()=>loadMirror(u);

list.appendChild(div);

});

}



async function loadMirror(user){

const res = await fetch(API_URL+"/history/"+user);

const history = await res.json();

const mirror = document.getElementById("mirrorChat");

mirror.innerHTML="";

history.forEach(m=>{

const q = document.createElement("div");
q.innerText="👤 "+m.message;

const a = document.createElement("div");
a.innerText="🤖 "+m.reply;

mirror.appendChild(q);
mirror.appendChild(a);

});

}



async function loadMyHistory(){

const res = await fetch(API_URL+"/history/"+username);

const history = await res.json();

history.forEach(m=>{

addMessage("user",m.message);
addMessage("bot",m.reply);

});

}



async function deleteMyChat(){

await fetch(API_URL+"/delete/"+username,{
method:"DELETE"
});

document.getElementById("chat").innerHTML="";

}

