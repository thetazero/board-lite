# Motion audit

3 bots, seed 7, a move every 1000 ms: 731 s of play, to round 25 (stopped after 12 min). Each line: how often it was seen, then its clips (clips/NAME.gif, and clips/NAME.strip.jpg with each frame's time from the moment; the frames in clips/NAME/).

- **tv: health bar snaps** ×198: 038-tv-snap, 039-tv-snap, 040-tv-snap
  first: `{"t":1793782870974,"page":"tv","kind":"snap","what":"health bar","el":"result > div.fighter.unit[u=2]","from":100,"to":67,"replaced":true,"s":63.66}`
- **phone: rerun transition:transform on handfan > div.card[card]** ×167: 030-phone-rerun, 031-phone-rerun, 036-phone-rerun
  first: `{"t":1793782860198,"page":"phone","kind":"rerun","name":"transition:transform","el":"handfan > div.card.k-building.longname[card]","afterMs":2586,"s":52.89}`
- **tv: cut dmg on span.dmg** ×146: 041-tv-cut, 042-tv-cut, 043-tv-cut
  first: `{"t":1793782871859,"page":"tv","kind":"cut","name":"dmg","el":"span.dmg","ranMs":874,"s":64.55}`
- **phone: card in the hand moves snaps (re-fanned or lifted)** ×109: 010-phone-snap, 023-phone-snap, 025-phone-snap
  first: `{"t":1793782822983,"page":"phone","kind":"snap","what":"card in the hand moves","el":"handfan > div.card.k-dragon.dim.longname[card]","from":565,"to":496,"replaced":true,"s":15.67}`
- **phone: card in the hand moves snaps (whole hand moves)** ×44: 028-phone-snap, 032-phone-snap, 045-phone-snap
  first: `{"t":1793782857612,"page":"phone","kind":"snap","what":"card in the hand moves","el":"handfan > div.card.k-building[card]","from":497,"to":1129,"replaced":true,"s":50.3}`
- **phone: rerun zoomin on #app > div.card.big** ×34: 006-phone-rerun, 008-phone-rerun, 024-phone-rerun
  first: `{"t":1793782811921,"page":"phone","kind":"rerun","name":"zoomin","el":"#app > div.card.big.k-building","afterMs":200,"s":4.61}`
- **phone: rerun fadein on #app > div.zoom** ×32: 014-phone-rerun, 017-phone-rerun, 019-phone-rerun
  first: `{"t":1793782828804,"page":"phone","kind":"rerun","name":"fadein","el":"#app > div.zoom","afterMs":117,"s":21.49}`
- **phone: rerun zoomin on #zoom > div.card.big** ×32: 015-phone-rerun, 018-phone-rerun, 020-phone-rerun
  first: `{"t":1793782828804,"page":"phone","kind":"rerun","name":"zoomin","el":"#zoom > div.card.big.k-dragon","afterMs":117,"s":21.49}`
- **tv: rerun dmg on fighter > span.dmg** ×32: 044-tv-rerun, 069-tv-rerun, 078-tv-rerun
  first: `{"t":1793782872585,"page":"tv","kind":"rerun","name":"dmg","el":"fighter > span.dmg","afterMs":400,"s":65.27}`
- **phone: rerun deal on handfan > div.card[card]** ×25: 007-phone-rerun, 055-phone-rerun, 056-phone-rerun
  first: `{"t":1793782811921,"page":"phone","kind":"rerun","name":"deal","el":"handfan > div.card.k-dragon.dealt.longname[card]","afterMs":200,"s":4.61}`
- **tv: banner production -> hidden** ×25: 009-tv-swap, 022-tv-swap, 053-tv-swap
  first: `{"t":1793782813921,"page":"tv","kind":"swap","from":"board | overlay banner production","to":"board | overlay hidden","animated":false,"s":6.61}`
- **phone: cut deal on handfan > div.card[card]** ×24: 005-phone-cut, 054-phone-cut, 066-phone-cut
  first: `{"t":1793782811892,"page":"phone","kind":"cut","name":"deal","el":"handfan > div.card.k-dragon.dealt.longname[card]","ranMs":171,"s":4.58}`
- **tv: banner fight -> hidden** ×19: 071-tv-swap, 081-tv-swap, 088-tv-swap
  first: `{"t":1793782934633,"page":"tv","kind":"swap","from":"board | overlay banner fight","to":"board | overlay hidden","animated":false,"s":127.32}`
- **tv: raid vote -> raid commit** ×18: 033-tv-swap, 049-tv-swap, 062-tv-swap
  first: `{"t":1793782860210,"page":"tv","kind":"swap","from":"board | overlay raid raid","to":"board | overlay raid commit","animated":false,"s":52.9}`
- **tv: hidden -> raid vote** ×17: 029-tv-swap, 061-tv-swap, 073-tv-swap
  first: `{"t":1793782857622,"page":"tv","kind":"swap","from":"board | overlay hidden","to":"board | overlay raid raid","animated":false,"s":50.31}`
- **phone: Your turn -> someone's turn** ×16: 011-phone-swap, 058-phone-swap, 067-phone-swap
  first: `{"t":1793782827787,"page":"phone","kind":"swap","from":"Your turn","to":"Bram's turn","animated":false,"s":20.48}`
- **tv: raid commit -> raid fight-or-bail** ×16: 035-tv-swap, 050-tv-swap, 063-tv-swap
  first: `{"t":1793782866619,"page":"tv","kind":"swap","from":"board | overlay raid commit","to":"board | overlay raid fight","animated":false,"s":59.31}`
- **phone: waiting -> watch-tv** ×16: 037-phone-swap, 051-phone-swap, 064-phone-swap
  first: `{"t":1793782869369,"page":"phone","kind":"swap","from":"Waiting for Cora.","to":"watch-tv","animated":false,"s":62.06}`
- **phone: discard -> watch-tv** ×16: 089-phone-swap, 093-phone-swap, 096-phone-swap
  first: `{"t":1793782997430,"page":"phone","kind":"swap","from":"Discard 1 cards8/7","to":"watch-tv","animated":false,"s":190.12}`
- **phone: raid vote -> waiting** ×15: 047-phone-swap, 074-phone-swap, 086-phone-swap
  first: `{"t":1793782880535,"page":"phone","kind":"swap","from":"raid Vote","to":"Waiting for Bram and Cora.","animated":false,"s":73.22}`
- **phone: cut transition:transform on handfan > div.card[card]** ×14: 113-phone-cut, 114-phone-cut, 115-phone-cut
  first: `{"t":1793783187330,"page":"phone","kind":"cut","name":"transition:transform","el":"handfan > div.card.k-action.longname[card]","ranMs":44,"s":380.02}`
- **phone: cut zoomin on #zoom > div.card.big** ×13: 013-phone-cut, 060-phone-cut, 084-phone-cut
  first: `{"t":1793782828776,"page":"phone","kind":"cut","name":"zoomin","el":"#zoom > div.card.big.k-dragon","ranMs":89,"s":21.46}`
- **phone: cut fadein on div.zoom** ×11: 012-phone-cut, 059-phone-cut, 083-phone-cut
  first: `{"t":1793782828776,"page":"phone","kind":"cut","name":"fadein","el":"div.zoom","ranMs":89,"s":21.46}`
- **phone: waiting -> waiting** ×9: 048-phone-swap, 101-phone-swap, 110-phone-swap
  first: `{"t":1793782881535,"page":"phone","kind":"swap","from":"Waiting for Bram and Cora.","to":"Waiting for Cora.","animated":false,"s":74.22}`
- **phone: someone's turn -> someone's turn** ×8: 026-phone-swap, 072-phone-swap, 097-phone-swap
  first: `{"t":1793782850970,"page":"phone","kind":"swap","from":"Bram's turn","to":"Cora's turn","animated":false,"s":43.66}`
- **phone: someone's turn -> Your turn** ×8: 027-phone-swap, 090-phone-swap, 098-phone-swap
  first: `{"t":1793782852403,"page":"phone","kind":"swap","from":"Cora's turn","to":"Your turn","animated":false,"s":45.09}`
- **phone: card open | someone's turn -> Your turn** ×8: 057-phone-swap, 085-phone-swap, 102-phone-swap
  first: `{"t":1793782894935,"page":"phone","kind":"swap","from":"card open | Cora's turn","to":"Your turn","animated":false,"s":87.62}`
- **phone: watch-tv -> discard** ×7: 087-phone-swap, 091-phone-swap, 099-phone-swap
  first: `{"t":1793782994765,"page":"phone","kind":"swap","from":"watch-tv","to":"Discard 1 cards8/7","animated":false,"s":187.45}`
- **phone: cut zoomin on div.card.big** ×6: 003-phone-cut, 004-phone-cut, 131-phone-cut
  first: `{"t":1793782811891,"page":"phone","kind":"cut","name":"zoomin","el":"div.card.big.k-building","ranMs":170,"s":4.58}`
- **phone: card open | someone's turn -> someone's turn** ×6: 016-phone-swap, 082-phone-swap, 107-phone-swap
  first: `{"t":1793782830154,"page":"phone","kind":"swap","from":"card open | Bram's turn","to":"Cora's turn","animated":false,"s":22.84}`
- **phone: raid fight-or-bail -> watch-tv** ×5: 077-phone-swap, 095-phone-swap, 121-phone-swap
  first: `{"t":1793782946965,"page":"phone","kind":"swap","from":"raid Frostpeak secret","to":"watch-tv","animated":false,"s":139.65}`
- **phone: someone's turn -> watch-tv** ×4: 068-phone-swap, 104-phone-swap, 128-phone-swap
  first: `{"t":1793782926116,"page":"phone","kind":"swap","from":"Bram's turn","to":"watch-tv","animated":false,"s":118.81}`
- **phone: watch-tv -> someone's turn** ×4: 070-phone-swap, 105-phone-swap, 129-phone-swap
  first: `{"t":1793782934616,"page":"phone","kind":"swap","from":"watch-tv","to":"Bram's turn","animated":false,"s":127.31}`
- **tv: banner result -> hidden** ×3: 092-tv-swap, 127-tv-swap, 132-tv-swap
  first: `{"t":1793783019163,"page":"tv","kind":"swap","from":"board | overlay banner result","to":"board | overlay hidden","animated":false,"s":211.85}`
- **phone: discard -> waiting** ×3: 100-phone-swap, 112-phone-swap, 125-phone-swap
  first: `{"t":1793783082443,"page":"phone","kind":"swap","from":"Discard 2 cards9/7","to":"Waiting for Bram and Cora.","animated":false,"s":275.13}`
- **phone: someone's turn -> discard** ×3: 106-phone-swap, 111-phone-swap, 124-phone-swap
  first: `{"t":1793783122608,"page":"phone","kind":"swap","from":"Cora's turn","to":"Discard 1 cards8/7","animated":false,"s":315.3}`
- **phone: Your turn -> watch-tv** ×3: 108-phone-swap, 118-phone-swap, 133-phone-swap
  first: `{"t":1793783134025,"page":"phone","kind":"swap","from":"Your turn","to":"watch-tv","animated":false,"s":326.71}`
- **phone: watch-tv -> Your turn** ×3: 109-phone-swap, 119-phone-swap, 134-phone-swap
  first: `{"t":1793783144124,"page":"phone","kind":"swap","from":"watch-tv","to":"Your turn","animated":false,"s":336.81}`
- **phone: card open | someone's turn -> watch-tv** ×2: 021-phone-swap, 080-phone-swap
  first: `{"t":1793782841853,"page":"phone","kind":"swap","from":"card open | Cora's turn","to":"watch-tv","animated":false,"s":34.54}`
- **tv: banner result -> banner production** ×2: 052-tv-swap, 065-tv-swap
  first: `{"t":1793782889768,"page":"tv","kind":"swap","from":"board | overlay banner result","to":"board | overlay banner production","animated":false,"s":82.46}`
- **phone: raid Stormspire everyone see -> raid fight-or-bail** ×2: 094-phone-swap, 123-phone-swap
  first: `{"t":1793783037779,"page":"phone","kind":"swap","from":"raid Stormspire everyone see","to":"raid Stormspire secret","animated":false,"s":230.47}`
- **phone: card open | someone's turn -> discard** ×2: 103-phone-swap, 116-phone-swap
  first: `{"t":1793783096243,"page":"phone","kind":"swap","from":"card open | Bram's turn","to":"Discard 2 cards9/7","animated":false,"s":288.93}`
- **tv: none -> hidden** ×1: 001-tv-swap
  first: `{"t":1793782807456,"page":"tv","kind":"swap","from":"board | overlay none","to":"board | overlay hidden","animated":false,"s":0.14}`
- **tv: hidden -> lobby | overlay hidden** ×1: 002-tv-swap
  first: `{"t":1793782807577,"page":"tv","kind":"swap","from":"board | overlay hidden","to":"lobby | overlay hidden","animated":false,"s":0.27}`
- **phone: raid Knightsgate everyone se -> waiting** ×1: 034-phone-swap
  first: `{"t":1793782866385,"page":"phone","kind":"swap","from":"raid Knightsgate everyone se","to":"Waiting for Cora.","animated":false,"s":59.07}`
- **tv: banner fight -> raid vote** ×1: 046-tv-swap
  first: `{"t":1793782877914,"page":"tv","kind":"swap","from":"board | overlay banner fight","to":"board | overlay raid raid","animated":false,"s":70.6}`
- **phone: waiting -> raid commit** ×1: 075-phone-swap
  first: `{"t":1793782940049,"page":"phone","kind":"swap","from":"Waiting for Cora.","to":"raid Frostpeak everyone sees","animated":false,"s":132.74}`
- **phone: raid commit -> raid fight-or-bail** ×1: 076-phone-swap
  first: `{"t":1793782944699,"page":"phone","kind":"swap","from":"raid Frostpeak everyone sees","to":"raid Frostpeak secret","animated":false,"s":137.39}`
- **tv: banner fight -> banner production** ×1: 079-tv-swap
  first: `{"t":1793782955082,"page":"tv","kind":"swap","from":"board | overlay banner fight","to":"board | overlay banner production","animated":false,"s":147.77}`
- **phone: Your turn -> discard** ×1: 117-phone-swap
  first: `{"t":1793783210555,"page":"phone","kind":"swap","from":"Your turn","to":"Discard 2 cards9/7","animated":false,"s":403.24}`
- **phone: raid Knightsgate everyone se -> raid fight-or-bail** ×1: 120-phone-swap
  first: `{"t":1793783275403,"page":"phone","kind":"swap","from":"raid Knightsgate everyone se","to":"raid Knightsgate secret","animated":false,"s":468.09}`
- **phone: Your turn -> raid vote** ×1: 122-phone-swap
  first: `{"t":1793783301770,"page":"phone","kind":"swap","from":"Your turn","to":"raid Vote","animated":false,"s":494.46}`
- **phone: watch-tv -> waiting** ×1: 126-phone-swap
  first: `{"t":1793783355299,"page":"phone","kind":"swap","from":"watch-tv","to":"Waiting for Bram and Cora.","animated":false,"s":547.99}`
- **phone: raid Hamlet of Brindle secre -> watch-tv** ×1: 130-phone-swap
  first: `{"t":1793783416780,"page":"phone","kind":"swap","from":"raid Hamlet of Brindle secre","to":"watch-tv","animated":false,"s":609.47}`
