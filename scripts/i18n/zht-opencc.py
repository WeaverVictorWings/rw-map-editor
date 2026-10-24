import json,sys
D='occ/data/dictionary/'
def load(f):
    d={}
    for l in open(D+f,encoding='utf8'):
        if '\t' in l:
            k,v=l.rstrip('\n').split('\t'); d[k]=v.split(' ')[0]
    return d
def conv(s,dicts):
    for d in dicts:
        ml=max(len(k) for k in d); out=[]; i=0
        while i<len(s):
            for L in range(min(ml,len(s)-i),0,-1):
                if s[i:i+L] in d: out.append(d[s[i:i+L]]); i+=L; break
            else: out.append(s[i]); i+=1
        s=''.join(out)
    return s
st={**load('STCharacters.txt'),**load('STPhrases.txt')}
tw={**load('TWVariants.txt'),**load('TWPhrases.txt')}
arr=json.load(open('strings.json'))
res={k:conv(conv(k,[st]),[tw]) for k in arr}
json.dump(res,open('zht.json','w'),ensure_ascii=False)
print(conv(conv('这张地图没有物品图块集，资源池和出生点；软件 鼠标 文件夹 设置 打开 保存到游戏文件夹 视频 网格 撤销 重做',[st]),[tw]))
