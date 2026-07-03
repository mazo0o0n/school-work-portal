(function(){
  document.documentElement.classList.add('booting');

  if(localStorage.getItem('preferredTheme') === 'dark'){
    document.documentElement.classList.add('preload-dark');
    document.addEventListener('DOMContentLoaded', () => {
      document.body.classList.add('dark');
    });
  }

  const hasSchool = (localStorage.getItem('registeredSchoolName') || localStorage.getItem('registeredSchoolBaseName') || '').trim();
  const guestMode = localStorage.getItem('schoolGuestMode') === '1';
  if(!hasSchool && !guestMode){
    window.location.replace('register.html');
  }
})();
