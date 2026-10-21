const express = require('express');
const app = express();



app.use(express.json());


app.get('/', function (req, res) {
  res.send('GAndu server mast chale che!');
});


app.post('/chat', function (req, res) {
  console.log('Parcel aavyu bapuu: ', req.body);
  


  res.json({ 
    reply: "Hello from the server!" 
  });
});


app.listen(1001, function () {
  console.log('Server is running on http://localhost:10001');
});
