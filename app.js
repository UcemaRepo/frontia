const API_URL = "https://backendia-khz7.onrender.com";

let mirrorHistory = [];
let mirrorUser = null;


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
user:username,
personality: document.getElementById("personality").value
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

const res = await fetch(API_URL + "/users");

const users = await res.json();

const list = document.getElementById("usersList");

list.innerHTML = "";

users.forEach(u => {

const card = document.createElement("div");
card.className = "userCard";

card.onclick = () => loadMirror(u.name);

const status = document.createElement("span");
status.className = "statusDot";

if(u.online){
status.classList.add("online");
}else{
status.classList.add("offline");
}

const name = document.createElement("span");
name.className = "userName";
name.innerText = u.name;

card.appendChild(status);
card.appendChild(name);

list.appendChild(card);

});

}


async function loadMirror(user){

mirrorUser = user;

const res = await fetch(API_URL+"/history/"+user);

const history = await res.json();

mirrorHistory = history;

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

function joinChat(){

if(!mirrorHistory.length) return;

const chat = document.getElementById("chat");

chat.innerHTML="";

mirrorHistory.forEach(m=>{

addMessage("user",m.message);
addMessage("bot",m.reply);

});

alert("Ahora continuás este chat desde tu usuario");

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

async function uploadFile(){

const fileInput = document.getElementById("fileUpload");

if(!fileInput.files.length) return;

const formData = new FormData();

formData.append("file", fileInput.files[0]);
formData.append("user", username);

await fetch(API_URL+"/upload",{
method:"POST",
body:formData
});

alert("Archivo subido");

}

const messageInput = document.getElementById("message");

messageInput.addEventListener("keydown", function(event){

if(event.key === "Enter" && !event.shiftKey){

event.preventDefault();

sendMessage();

}

});





