var express = require('express');

var app = express();

var PORT = 3000;
 
// View engine setup

app.set('view engine', 'ejs');
 
// With middleware

app.use('/', function(req, res, next){

    res.render('User')

    next();
});
 

app.get('/', function(req, res){

    console.log("Render Working")

    res.send();
});
 

app.listen(PORT, function(err){

    if (err) console.log(err);

    console.log("Server listening on PORT", PORT);
});
