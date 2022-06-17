const args = process.argv.slice(2);

args.forEach(arg => {
  console.log(process.env[arg]);
});
