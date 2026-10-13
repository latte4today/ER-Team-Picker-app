"""Check direction symmetry and prevent post-game outcome leakage."""
import copy
import unittest
from analyze_matchup_outcomes import pair_features, build_key

class MatchupTests(unittest.TestCase):
    def test_swap_and_no_outcome_features(self):
        a={'teamMmr':2000,'members':[{'variantId':v,'traits':{'core':1}} for v in ['a:sword','b:bow','c:glove']]}
        b={'teamMmr':3100,'members':[{'variantId':v,'traits':{'core':2}} for v in ['d:bow','b:bow','e:axe']]}
        forward=pair_features(a,b)
        backward=pair_features(b,a)
        for f,r in zip(forward,backward):
            self.assertEqual(f.keys(),r.keys())
            for key in f:self.assertAlmostEqual(f[key],-r[key])
        changed=copy.deepcopy(a)
        changed['result']={'placement':1,'isWin':True}
        changed['members'][0]['stats']={'kills':100,'damageToPlayer':999999}
        self.assertEqual(pair_features(changed,b),forward)
        changed['members'].reverse()
        self.assertEqual(build_key(changed,True),build_key(a,True))

if __name__=='__main__': unittest.main()
