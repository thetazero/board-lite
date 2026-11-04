# Motion audit

Written again from the run's log. Each line: how often it was seen, then its clips (clips/NAME.gif, and clips/NAME.strip.jpg with each frame's time from the moment; the frames in clips/NAME/).

- **tv: health bar snaps** ×1028: 041-tv-snap, 042-tv-snap, 043-tv-snap
  first: `{"t":1793778831975,"page":"tv","kind":"snap","what":"health bar","el":"result > div.fighter.unit[u=2]","from":100,"to":29,"replaced":true,"s":84.11}`
- **tv: cut dmg on span.dmg** ×762: 044-tv-cut, 045-tv-cut, 046-tv-cut
  first: `{"t":1793778832820,"page":"tv","kind":"cut","name":"dmg","el":"span.dmg","ranMs":709,"s":84.96}`
- **phone: card in the hand moves snaps (re-fanned or lifted)** ×500: 010-phone-snap, 021-phone-snap, 037-phone-snap
  first: `{"t":1793778766148,"page":"phone","kind":"snap","what":"card in the hand moves","el":"handfan > div.card.k-dragon.dim.longname[card]","from":565,"to":496,"replaced":true,"s":18.28}`
- **phone: rerun transition:transform on handfan > div.card[card]** ×484: 024-phone-rerun, 053-phone-rerun, 054-phone-rerun
  first: `{"t":1793778789265,"page":"phone","kind":"rerun","name":"transition:transform","el":"handfan > div.card.k-dragon.longname[card]","afterMs":265,"s":41.4}`
- **phone: card in the hand moves snaps (whole hand moves)** ×320: 030-phone-snap, 033-phone-snap, 034-phone-snap
  first: `{"t":1793778815402,"page":"phone","kind":"snap","what":"card in the hand moves","el":"handfan > div.card.k-building[card]","from":497,"to":1129,"replaced":true,"s":67.54}`
- **tv: rerun dmg on fighter > span.dmg** ×150: 047-tv-rerun, 068-tv-rerun, 069-tv-rerun
  first: `{"t":1793778835317,"page":"tv","kind":"rerun","name":"dmg","el":"fighter > span.dmg","afterMs":416,"s":87.45}`
- **phone: rerun fadein on #app > div.zoom** ×139: 014-phone-rerun, 017-phone-rerun, 062-phone-rerun
  first: `{"t":1793778772084,"page":"phone","kind":"rerun","name":"fadein","el":"#app > div.zoom","afterMs":268,"s":24.22}`
- **phone: rerun zoomin on #zoom > div.card.big** ×139: 015-phone-rerun, 018-phone-rerun, 063-phone-rerun
  first: `{"t":1793778772084,"page":"phone","kind":"rerun","name":"zoomin","el":"#zoom > div.card.big.k-dragon","afterMs":268,"s":24.22}`
- **phone: cut transition:transform on handfan > div.card[card]** ×129: 107-phone-cut, 108-phone-cut, 109-phone-cut
  first: `{"t":1793779074169,"page":"phone","kind":"cut","name":"transition:transform","el":"handfan > div.card.k-action[card]","ranMs":199,"s":326.31}`
- **phone: rerun zoomin on #app > div.card.big** ×106: 006-phone-rerun, 008-phone-rerun, 052-phone-rerun
  first: `{"t":1793778752522,"page":"phone","kind":"rerun","name":"zoomin","el":"#app > div.card.big.k-building","afterMs":272,"s":4.66}`
- **tv: banner fight -> hidden** ×87: 075-tv-swap, 085-tv-swap, 092-tv-swap
  first: `{"t":1793778910244,"page":"tv","kind":"swap","from":"board | overlay banner fight","to":"board | overlay hidden","animated":false,"s":162.38}`
- **phone: cut deal on handfan > div.card[card]** ×69: 005-phone-cut, 022-phone-cut, 050-phone-cut
  first: `{"t":1793778752431,"page":"phone","kind":"cut","name":"deal","el":"handfan > div.card.k-dragon.dealt.longname[card]","ranMs":181,"s":4.57}`
- **tv: banner production -> hidden** ×64: 009-tv-swap, 020-tv-swap, 049-tv-swap
  first: `{"t":1793778754738,"page":"tv","kind":"swap","from":"board | overlay banner production","to":"board | overlay hidden","animated":false,"s":6.87}`
- **phone: rerun deal on handfan > div.card[card]** ×63: 007-phone-rerun, 025-phone-rerun, 051-phone-rerun
  first: `{"t":1793778752522,"page":"phone","kind":"rerun","name":"deal","el":"handfan > div.card.k-dragon.dealt.longname[card]","afterMs":272,"s":4.66}`
- **tv: raid vote -> raid commit** ×55: 036-tv-swap, 065-tv-swap, 079-tv-swap
  first: `{"t":1793778818889,"page":"tv","kind":"swap","from":"board | overlay raid raid","to":"board | overlay raid commit","animated":false,"s":71.03}`
- **phone: waiting -> watch-tv** ×54: 040-phone-swap, 067-phone-swap, 114-phone-swap
  first: `{"t":1793778830317,"page":"phone","kind":"swap","from":"Waiting for Cora.","to":"watch-tv","animated":false,"s":82.45}`
- **tv: raid commit -> raid fight-or-bail** ×52: 038-tv-swap, 066-tv-swap, 081-tv-swap
  first: `{"t":1793778828117,"page":"tv","kind":"swap","from":"board | overlay raid commit","to":"board | overlay raid fight","animated":false,"s":80.25}`
- **phone: raid vote -> waiting** ×51: 032-phone-swap, 077-phone-swap, 097-phone-swap
  first: `{"t":1793778817697,"page":"phone","kind":"swap","from":"raid Vote","to":"Waiting for Cora.","animated":false,"s":69.83}`
- **phone: cut zoomin on #zoom > div.card.big** ×50: 013-phone-cut, 057-phone-cut, 061-phone-cut
  first: `{"t":1793778771913,"page":"phone","kind":"cut","name":"zoomin","el":"#zoom > div.card.big.k-dragon","ranMs":97,"s":24.05}`
- **tv: hidden -> raid vote** ×48: 031-tv-swap, 064-tv-swap, 076-tv-swap
  first: `{"t":1793778815514,"page":"tv","kind":"swap","from":"board | overlay hidden","to":"board | overlay raid raid","animated":false,"s":67.65}`
- **phone: cut fadein on div.zoom** ×43: 012-phone-cut, 056-phone-cut, 060-phone-cut
  first: `{"t":1793778771913,"page":"phone","kind":"cut","name":"fadein","el":"div.zoom","ranMs":97,"s":24.05}`
- **phone: discard -> watch-tv** ×41: 089-phone-swap, 095-phone-swap, 100-phone-swap
  first: `{"t":1793778960575,"page":"phone","kind":"swap","from":"Discard 1 cards8/7","to":"watch-tv","animated":false,"s":212.71}`
- **phone: cut zoomin on div.card.big** ×30: 003-phone-cut, 004-phone-cut, 023-phone-cut
  first: `{"t":1793778752431,"page":"phone","kind":"cut","name":"zoomin","el":"div.card.big.k-building","ranMs":181,"s":4.57}`
- **phone: waiting -> waiting** ×30: 026-phone-swap, 113-phone-swap, 128-phone-swap
  first: `{"t":1793778790049,"page":"phone","kind":"swap","from":"Waiting for Bram and Cora.","to":"Waiting for Cora.","animated":false,"s":42.19}`
- **phone: Your turn -> someone's turn** ×23: 011-phone-swap, 059-phone-swap, 071-phone-swap
  first: `{"t":1793778770932,"page":"phone","kind":"swap","from":"Your turn","to":"Bram's turn","animated":false,"s":23.07}`
- **phone: card open | someone's turn -> someone's turn** ×21: 016-phone-swap, 086-phone-swap, 096-phone-swap
  first: `{"t":1793778773466,"page":"phone","kind":"swap","from":"card open | Bram's turn","to":"Cora's turn","animated":false,"s":25.6}`
- **phone: someone's turn -> someone's turn** ×21: 028-phone-swap, 072-phone-swap, 101-phone-swap
  first: `{"t":1793778808148,"page":"phone","kind":"swap","from":"Bram's turn","to":"Cora's turn","animated":false,"s":60.28}`
- **phone: someone's turn -> watch-tv** ×17: 073-phone-swap, 090-phone-swap, 110-phone-swap
  first: `{"t":1793778902027,"page":"phone","kind":"swap","from":"Cora's turn","to":"watch-tv","animated":false,"s":154.16}`
- **phone: watch-tv -> someone's turn** ×17: 074-phone-swap, 091-phone-swap, 111-phone-swap
  first: `{"t":1793778910128,"page":"phone","kind":"swap","from":"watch-tv","to":"Cora's turn","animated":false,"s":162.26}`
- **phone: Your turn -> watch-tv** ×16: 116-phone-swap, 136-phone-swap, 137-phone-swap
  first: `{"t":1793779124055,"page":"phone","kind":"swap","from":"Your turn","to":"watch-tv","animated":false,"s":376.19}`
- **phone: raid fight-or-bail -> watch-tv** ×15: 082-phone-swap, 099-phone-swap, 126-phone-swap
  first: `{"t":1793778924844,"page":"phone","kind":"swap","from":"raid Tidewatch secret","to":"watch-tv","animated":false,"s":176.98}`
- **phone: card open | someone's turn -> watch-tv** ×13: 019-phone-swap, 084-phone-swap, 104-phone-swap
  first: `{"t":1793778783049,"page":"phone","kind":"swap","from":"card open | Cora's turn","to":"watch-tv","animated":false,"s":35.19}`
- **phone: discard -> waiting** ×11: 118-phone-swap, 123-phone-swap, 133-phone-swap
  first: `{"t":1793779137785,"page":"phone","kind":"swap","from":"Discard 2 cards9/7","to":"Waiting for Cora.","animated":false,"s":389.92}`
- **phone: someone's turn -> Your turn** ×10: 029-phone-swap, 093-phone-swap, 102-phone-swap
  first: `{"t":1793778810564,"page":"phone","kind":"swap","from":"Cora's turn","to":"Your turn","animated":false,"s":62.7}`
- **phone: card open | someone's turn -> Your turn** ×9: 058-phone-swap, 087-phone-swap, 105-phone-swap
  first: `{"t":1793778855810,"page":"phone","kind":"swap","from":"card open | Cora's turn","to":"Your turn","animated":false,"s":107.95}`
- **phone: Your turn -> discard** ×8: 088-phone-swap, 103-phone-swap, 117-phone-swap
  first: `{"t":1793778954892,"page":"phone","kind":"swap","from":"Your turn","to":"Discard 1 cards8/7","animated":false,"s":207.03}`
- **phone: waiting -> raid commit** ×7: 035-phone-swap, 078-phone-swap, 124-phone-swap
  first: `{"t":1793778818831,"page":"phone","kind":"swap","from":"Waiting for Cora.","to":"raid Tidewatch everyone sees","animated":false,"s":70.97}`
- **phone: watch-tv -> discard** ×7: 132-phone-swap, 139-phone-swap, 140-phone-swap
  first: `{"t":1793779454325,"page":"phone","kind":"swap","from":"watch-tv","to":"Discard 1 cards8/7","animated":false,"s":706.46}`
- **tv: banner fight -> raid vote** ×6: 121-tv-swap, 152-tv-swap, 155-tv-swap
  first: `{"t":1793779166551,"page":"tv","kind":"swap","from":"board | overlay banner fight","to":"board | overlay raid raid","animated":false,"s":418.69}`
- **phone: waiting -> raid Stormspire everyone see** ×6: 129-phone-swap, 131-phone-swap, 153-phone-swap
  first: `{"t":1793779262496,"page":"phone","kind":"swap","from":"Waiting for Cora.","to":"raid Stormspire everyone see","animated":false,"s":514.63}`
- **phone: waiting -> someone's turn** ×5: 027-phone-swap, 055-phone-swap, 115-phone-swap
  first: `{"t":1793778805683,"page":"phone","kind":"swap","from":"Waiting for Cora.","to":"Bram's turn","animated":false,"s":57.82}`
- **phone: waiting -> raid Hamlet of Brindle every** ×5: 119-phone-swap, 138-phone-swap, 141-phone-swap
  first: `{"t":1793779151643,"page":"phone","kind":"swap","from":"Waiting for Cora.","to":"raid Hamlet of Brindle every","animated":false,"s":403.78}`
- **phone: raid fight-or-bail -> waiting** ×4: 039-phone-swap, 130-phone-swap, 160-phone-swap
  first: `{"t":1793778830317,"page":"phone","kind":"swap","from":"raid Tidewatch secret","to":"Waiting for Cora.","animated":false,"s":82.45}`
- **phone: raid commit -> raid fight-or-bail** ×4: 080-phone-swap, 125-phone-swap, 135-phone-swap
  first: `{"t":1793778921851,"page":"phone","kind":"swap","from":"raid Tidewatch everyone sees","to":"raid Tidewatch secret","animated":false,"s":173.99}`
- **phone: raid Hamlet of Brindle secre -> watch-tv** ×4: 120-phone-swap, 142-phone-swap, 149-phone-swap
  first: `{"t":1793779158350,"page":"phone","kind":"swap","from":"raid Hamlet of Brindle secre","to":"watch-tv","animated":false,"s":410.49}`
- **phone: waiting -> raid Archer's Hold everyone ** ×4: 146-phone-swap, 156-phone-swap, 173-phone-swap
  first: `{"t":1793780216042,"page":"phone","kind":"swap","from":"Waiting for Cora.","to":"raid Archer's Hold everyone ","animated":false,"s":1468.18}`
- **phone: raid Archer's Hold everyone  -> raid fight-or-bail** ×4: 147-phone-swap, 157-phone-swap, 174-phone-swap
  first: `{"t":1793780220992,"page":"phone","kind":"swap","from":"raid Archer's Hold everyone ","to":"raid Archer's Hold secret","animated":false,"s":1473.13}`
- **phone: waiting -> raid Knightsgate everyone se** ×4: 151-phone-swap, 165-phone-swap, 170-phone-swap
  first: `{"t":1793780359804,"page":"phone","kind":"swap","from":"Waiting for Cora.","to":"raid Knightsgate everyone se","animated":false,"s":1611.94}`
- **tv: banner fight -> banner production** ×3: 048-tv-swap, 070-tv-swap, 083-tv-swap
  first: `{"t":1793778840896,"page":"tv","kind":"swap","from":"board | overlay banner fight","to":"board | overlay banner production","animated":false,"s":93.03}`
- **tv: banner result -> hidden** ×3: 122-tv-swap, 134-tv-swap, 169-tv-swap
  first: `{"t":1793779176118,"page":"tv","kind":"swap","from":"board | overlay banner result","to":"board | overlay hidden","animated":false,"s":428.25}`
- **phone: someone's turn -> discard** ×2: 094-phone-swap, 144-phone-swap
  first: `{"t":1793778982041,"page":"phone","kind":"swap","from":"Bram's turn","to":"Discard 2 cards9/7","animated":false,"s":234.18}`
- **phone: raid Stormspire everyone see -> raid fight-or-bail** ×2: 098-phone-swap, 176-phone-swap
  first: `{"t":1793779003373,"page":"phone","kind":"swap","from":"raid Stormspire everyone see","to":"raid Stormspire secret","animated":false,"s":255.51}`
- **phone: card open | someone's turn -> discard** ×2: 106-phone-swap, 164-phone-swap
  first: `{"t":1793779066671,"page":"phone","kind":"swap","from":"card open | Bram's turn","to":"Discard 2 cards9/7","animated":false,"s":318.81}`
- **phone: raid commit -> waiting** ×2: 145-phone-swap, 158-phone-swap
  first: `{"t":1793779973313,"page":"phone","kind":"swap","from":"raid Frostpeak everyone sees","to":"Waiting for Bram.","animated":false,"s":1225.45}`
- **phone: raid Hamlet of Brindle every -> raid Hamlet of Brindle secre** ×2: 148-phone-swap, 150-phone-swap
  first: `{"t":1793780265339,"page":"phone","kind":"swap","from":"raid Hamlet of Brindle every","to":"raid Hamlet of Brindle secre","animated":false,"s":1517.47}`
- **phone: raid Stormspire everyone see -> waiting** ×2: 154-phone-swap, 161-phone-swap
  first: `{"t":1793780510431,"page":"phone","kind":"swap","from":"raid Stormspire everyone see","to":"Waiting for Bram and Cora.","animated":false,"s":1762.57}`
- **phone: waiting -> raid fight-or-bail** ×2: 159-phone-swap, 162-phone-swap
  first: `{"t":1793780568744,"page":"phone","kind":"swap","from":"Waiting for Cora.","to":"raid Frostpeak secret","animated":false,"s":1820.88}`
- **phone: Your turn -> raid vote** ×2: 163-phone-swap, 172-phone-swap
  first: `{"t":1793780739626,"page":"phone","kind":"swap","from":"Your turn","to":"raid Vote","animated":false,"s":1991.76}`
- **phone: raid Knightsgate everyone se -> raid fight-or-bail** ×2: 166-phone-swap, 171-phone-swap
  first: `{"t":1793780818004,"page":"phone","kind":"swap","from":"raid Knightsgate everyone se","to":"raid Knightsgate secret","animated":false,"s":2070.14}`
- **phone: watch-tv -> raid vote** ×2: 167-phone-swap, 175-phone-swap
  first: `{"t":1793780831042,"page":"phone","kind":"swap","from":"watch-tv","to":"raid Vote","animated":false,"s":2083.18}`
- **tv: none -> hidden** ×1: 001-tv-swap
  first: `{"t":1793778748002,"page":"tv","kind":"swap","from":"board | overlay none","to":"board | overlay hidden","animated":false,"s":0.14}`
- **tv: hidden -> lobby | overlay hidden** ×1: 002-tv-swap
  first: `{"t":1793778748140,"page":"tv","kind":"swap","from":"board | overlay hidden","to":"lobby | overlay hidden","animated":false,"s":0.28}`
- **phone: someone's turn -> waiting** ×1: 112-phone-swap
  first: `{"t":1793779102486,"page":"phone","kind":"swap","from":"Cora's turn","to":"Waiting for Bram and Cora.","animated":false,"s":354.62}`
- **phone: Your turn -> waiting** ×1: 127-phone-swap
  first: `{"t":1793779242764,"page":"phone","kind":"swap","from":"Your turn","to":"Waiting for Bram and Cora.","animated":false,"s":494.9}`
- **phone: watch-tv -> waiting** ×1: 143-phone-swap
  first: `{"t":1793779824727,"page":"phone","kind":"swap","from":"watch-tv","to":"Waiting for Bram and Cora.","animated":false,"s":1076.86}`
- **tv: banner result -> raid vote** ×1: 168-tv-swap
  first: `{"t":1793780942597,"page":"tv","kind":"swap","from":"board | overlay banner result","to":"board | overlay raid raid","animated":false,"s":2194.73}`
