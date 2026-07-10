(function(){
    var d=document.getElementById('page-loader');
    var b=document.getElementById('loader-bar');
    if(!d||!b)return;
    var start=Date.now(), MIN=1400;
    var pct=0, done=false, pageReady=false;
    function setBar(p){pct=Math.min(p,100);b.style.width=pct+'%';}
    function dismiss(){
        if(done)return;done=true;
        setBar(100);
        setTimeout(function(){
            d.style.opacity='0';
            d.style.pointerEvents='none';
            setTimeout(function(){d.style.display='none';},500);
        },300);
    }
    function tryFinish(){
        if(!pageReady)return;
        var wait=Math.max(0,MIN-(Date.now()-start));
        setTimeout(function(){
            var iv=setInterval(function(){
                if(pct>=100){clearInterval(iv);dismiss();}
                else setBar(pct+4);
            },16);
        },wait);
    }
    var step=0,total=60;
    var anim=setInterval(function(){
        step++;
        setBar(step*(85/total));
        if(step>=total)clearInterval(anim);
    },17);
    window.addEventListener('load',function(){pageReady=true;tryFinish();},{once:true});
    setTimeout(function(){pageReady=true;tryFinish();},8000);
})();
