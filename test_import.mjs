import('./src/data.js').then(() => console.log('data OK'))
  .catch(e => console.error('data ERROR:', e.message));
