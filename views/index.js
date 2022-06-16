var express = require('express');

var app = express();

var PORT = 3000;
 
// View engine setup

app.set('view engine', 'ejs');
 
// Without middleware

app.get('/user', function(req, res){
 

    // Rendering home.ejs page

    res.render('home');
})
 

app.listen(PORT, function(err){

    if (err) console.log(err);

    console.log("Server listening on PORT", PORT);
});
