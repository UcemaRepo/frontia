const API_URL = "https://backendia-khz7.onrender.com";

async function sendMessage(){

const message = document.getElementById("message").value;

const res = await fetch(API_URL + "/chat",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body: JSON.stringify({
message: message
})
});

const data = await res.json();

addMessage("user", message);
addMessage("bot", data.reply);

}

function addMessage(type,text){

const chat = document.getElementById("chat");

const div = document.createElement("div");
div.className = "message " + type;

div.innerText = text;

chat.appendChild(div);

chat.scrollTop = chat.scrollHeight;

}


async function setPersonality(){

const text = document.getElementById("personality").value;

await fetch(API_URL + "/personality",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body: JSON.stringify({
personality:text
})
});

alert("Personalidad guardada");

}

async function uploadFile(){

const file = document.getElementById("fileInput").files[0];

const form = new FormData();
form.append("file",file);

await fetch(API_URL + "/upload",{
method:"POST",
body:form
});

alert("Archivo subido");

}

