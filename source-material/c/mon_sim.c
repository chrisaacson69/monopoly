/*
 * Monopoly square probabilities.
 *
 * This program will use a simulation of many turns to find the probabilities
 * of landing on the different squares in Monopoly.  Two tables are printed
 * at the end.  One for the strategy of paying to get out of jail immediately
 * and the other is for the strategy of staying in as long as possible.  The
 * numbers are the probabilities that a player will end up on the gameboard
 * squares, which is somewhat different than the probability of landing on
 * squares.  Although one may land on the Go To Jail square, one never ends
 * up there.  A similar situation exists when landing on a Chance or Community
 * Chest square where there is a probability based on what card is chosen that
 * one will end up on a different square.
 *
 * I have also added a table that determines how likely it is on each square
 * for the last two rolls to have been doubles.  This is used by my other
 * program that calculates the probabilities using a Markov Matrix.
 *
 * By Truman Collins
 * January 14, 1997
 * April 17, 1997
 *
 * Copyright 1997 By Truman Collins
 */


/* Static data. */

static int square_count[41];
static int more_to_do[41];
static int chance_square[41];
static int comm_chest_square[41];
static int total_rolls_starting_here[41];
static int total_rolls_here_with_prev_two_doubles[41];
static long start_time, end_time, elapsed_time;
static int leave_jail;
static unsigned long limit;
static unsigned int passed_go_count;
static unsigned int pennsylvania_double;
static unsigned int total_pennsylvania;
static unsigned int b_and_o_double;
static unsigned int total_b_and_o;
static unsigned int reading_double;
static unsigned int total_reading;
static double chance_money;
static double comm_chest_money;
static unsigned int water_works_count;
static double water_works_roll_sum;
static unsigned int electric_co_count;
static double electric_co_roll_sum;


#include <stdio.h>
#include <time.h>
#include <stdlib.h>


void initialize(void)
   {
      int   i;

      /* First initialize everything to zero.   */

      for(i = 0; i < 41; i++) {
         square_count[i] = 0;
         more_to_do[i] = 0;
         chance_square[i] = 0;
         comm_chest_square[i] = 0;
         total_rolls_starting_here[i] = 0;
         total_rolls_here_with_prev_two_doubles[i] = 0;
      }

      /* Now set those bits that need to be.  */
      /* One for go to jail square and the others for Chance */
      /* and Community Chest. */

      more_to_do[30] = 1;
      more_to_do[2] = 1;
      comm_chest_square[2] = 1;
      more_to_do[7] = 1;
      chance_square[7] = 1;
      more_to_do[17] = 1;
      comm_chest_square[17] = 1;
      more_to_do[22] = 1;
      chance_square[22] = 1;
      more_to_do[33] = 1;
      comm_chest_square[33] = 1;
      more_to_do[36] = 1;
      chance_square[36] = 1;

      time(&start_time);
      srand(start_time);

      passed_go_count = 0;
      pennsylvania_double = 0;
      total_pennsylvania = 0;
      b_and_o_double = 0;
      total_b_and_o = 0;
      reading_double = 0;
      total_reading = 0;
      chance_money = 0;
      comm_chest_money = 0;
      water_works_count = 0;
      water_works_roll_sum = 0.0;
      electric_co_count = 0;
      electric_co_roll_sum = 0.0;
   }


void print_probabilities(
      char    *header
   )
   {
      int    i;
      double value;


      printf("\n\nLand-on frequencies as percentages after %lu rolls for prefered %s:\n",
              limit, header);

      for(i = 0; i < 41; i++) {
         if(i != 0 && i % 10 == 0) printf("\n");
         printf("%5.3f  ", 100.0 * square_count[i] / (double) limit);
      }
      printf("\n\n");

      printf("Probabilities we have had two doubles when rolling from a square\n");

      for(i = 0; i < 41; i++) {
         if(i != 0 && i % 10 == 0) printf("\n");
         if(total_rolls_starting_here[i] == 0.0) {
            value = 0.0;
         } else {
            value = (double) total_rolls_here_with_prev_two_doubles[i] /
                    (double) total_rolls_starting_here[i];
         }
         printf("%8.6f  ", value);
      }
      printf("\n");
      printf("Passed or landed on Go %lu times for an income per roll of %7.4f\n",
             passed_go_count, 200.0 * ((double) passed_go_count / (double) limit));

      printf("Income per roll from Chance cards: %6.4f\n",
             chance_money / (double) limit);
      printf("Income per roll from Community Chest cards: %6.4f\n",
             comm_chest_money / (double) limit);
      printf("Percent of time landing on Reading RR from Chance for double pay: %7.4f\n",
             100.0 * ((double) reading_double / (double) total_reading));
      printf("Percent of time landing on Pennsylvania RR from Chance for double pay: %7.4f\n",
             100.0 * ((double) pennsylvania_double / (double) total_pennsylvania));
      printf("Percent of time landing on B and O RR from Chance for double pay: %7.4f\n",
             100.0 * ((double) b_and_o_double / (double) total_b_and_o));
      printf("Average roll for Electric Company: %7.4f\n",
             electric_co_roll_sum / electric_co_count);
      printf("Average roll for Water Works: %7.4f\n",
             water_works_roll_sum / water_works_count);
   }


#define TRANSFER_TO_NEW_SQUARE(sq) \
   sq_count[curr_square]--; \
   curr_square = sq; \
   sq_count[curr_square]++;


void do_calculation(void)
   {
      int            curr_square = 0;
      int            roll1, roll2, full_roll;
      int            doubles_in_a_row;
      unsigned long  i;
      int            in_jail = 0;
      int            card;
      int           *sq_count;
      int           *more;
      int           *chance;
      int           *comm_chest;


      sq_count = square_count;
      more = more_to_do;
      chance = chance_square;
      comm_chest = comm_chest_square;

      for(i = 0; i < limit; i++) {

         /* Keep track of number of times starting here and the number */
         /* of those where two doubles were rolled previously.         */
         /* Don't bother for in jail square.                           */

         if(curr_square != 40) {
            total_rolls_starting_here[curr_square]++;
            if(doubles_in_a_row == 2) {
               total_rolls_here_with_prev_two_doubles[curr_square]++;
            }
            if(curr_square == 12) {
               electric_co_count++;
               electric_co_roll_sum += full_roll;
            }
            if(curr_square == 28) {
               water_works_count++;
               water_works_roll_sum += full_roll;
            }
         }

         /* If we've spent enough time in jail, get out, by            */
         /* transfering to the visiting jail square and continue.      */

         if(in_jail) {
            if(in_jail == leave_jail) {
               curr_square = 10;
               in_jail = 0;
               doubles_in_a_row = 0;
            } else {
               in_jail++;
            }
         }

         /* Roll the dice. */

         roll1 = rand() % 6 + 1;
         roll2 = rand() % 6 + 1;
         full_roll = roll1 + roll2;

         /* If we're in jail, see if we got out with a double.  If not */
         /* then just add to the in jail count and go to the next roll.*/

         if(in_jail) {
            if(roll1 == roll2) {
               curr_square = 10;
               in_jail = 0;
               doubles_in_a_row = 0;
            } else {
               sq_count[40]++;
               continue;
            }
         }

         /* Check for three doubles.  If found, go to jail.            */

         if(roll1 == roll2) {
            if(doubles_in_a_row == 2) {
               curr_square = 40;
               sq_count[curr_square]++;
               doubles_in_a_row = 0;
               in_jail = 1;
               continue;
            } else {
               doubles_in_a_row++;
            }
         } else {
            doubles_in_a_row = 0;
         }

         /* Make the move. */

         curr_square += full_roll;
         if(curr_square >= 40) {
            curr_square -= 40;
            passed_go_count++;
         }
         sq_count[curr_square]++;
         if(curr_square == 5) {
            total_reading++;
         }
         if(curr_square == 15) {
            total_pennsylvania++;
         }
         if(curr_square == 25) {
            total_b_and_o++;
         }

         /* Check for a square that causes another movement. */

         if(more[curr_square]) {
            if(curr_square == 30) {

               /* Go to jail square, count as jail square. */

               TRANSFER_TO_NEW_SQUARE(40);
               in_jail = 1;

            }

            /* Note that we can't use an else if after the Chance */
            /* section because from the last Chance square it's   */
            /* possible to end up in the last Community Chest,    */
            /* where you need to deal with that.                  */

            if(chance[curr_square]) {

               /* Here, we take a random Chance card. */
               /* If it sends us to another location, go there. */

               card = rand() % 16;

               switch(card) {
                  case 0 :

                     /* Go to Boardwalk. */

                     TRANSFER_TO_NEW_SQUARE(39);
                     break;

                  case 1 :

                     /* Go to Reading Railroad. */

                     TRANSFER_TO_NEW_SQUARE(5);
                     total_reading++;
                     passed_go_count++;
                     break;

                  case 2 :

                     /* Go to Illinois Ave. */

                     TRANSFER_TO_NEW_SQUARE(24);
                     if(curr_square == 36) {
                        passed_go_count++;
                     }
                     break;

                  case 3 :

                     /* Go to ST. Charles Place. */

                     TRANSFER_TO_NEW_SQUARE(11);
                     if(curr_square != 7) {
                        passed_go_count++;
                     }
                     break;

                  case 4 :

                     /* Go to Go. */

                     TRANSFER_TO_NEW_SQUARE(0);
                     passed_go_count++;
                     break;

                  case 5 :

                     /* Go to Jail. */

                     TRANSFER_TO_NEW_SQUARE(40);
                     in_jail = 1;
                     break;

                  case 6 :
                  case 7 :

                     /* Go to next railroad.  There are two cards. */

                     switch(curr_square) {
                        case  7 :

                          /* Go to the Pennsylvania Railroad. */

                          TRANSFER_TO_NEW_SQUARE(15);
                          pennsylvania_double++;
                          total_pennsylvania++;
                          break;

                        case 22 :

                          /* Go to the B & O Railroad. */

                          TRANSFER_TO_NEW_SQUARE(25);
                          b_and_o_double++;
                          total_b_and_o++;
                          break;

                        case 36 :

                          /* Go to the Reading Railroad. */

                          TRANSFER_TO_NEW_SQUARE(5);
                          reading_double++;
                          total_reading++;
                          break;

                        default :

                          /* This should never happen. */

                          fprintf(stderr, "Bad Chance square.  We are on %d.\n", curr_square);
                     }
                     break;

                  case 8 :

                     /* Go back three places. */

                     TRANSFER_TO_NEW_SQUARE(curr_square - 3);
                     break;

                  case 9 :

                     /* Go to the nearest Utility. */

                     switch(curr_square) {
                        case  7 :
                        case 36 :

                          /* Go to the Electric Company. */

                          TRANSFER_TO_NEW_SQUARE(12);
                          if(curr_square == 36) {
                             passed_go_count++;
                          }
                          break;

                        case 22 :

                          /* Go to the Water Works. */

                          TRANSFER_TO_NEW_SQUARE(28);
                          break;

                        default :

                          /* This should never happen. */

                          fprintf(stderr, "Bad Chance square.  We are on %d.\n", curr_square);
                     }
                     break;

                  case 10 :

                     /* Bank pays dividend of $50. */

                     chance_money += 50;
                     break;

                  case 11 :

                     /* Pay poor tax of $15. */

                     chance_money -= 15;
                     break;

                  case 12 :

                     /* Building loan matures, collect $150. */

                     chance_money += 150;
                     break;

                  default :

                     /* A card that leaves us on this square */
                     /* and that we do nothing with.         */

                     break;
               }

            }

            if(comm_chest[curr_square]) {

               /* Here, we take a random community chest card. */
               /* If it sends us to another location, go there. */

               card = rand() % 16;

               switch(card) {
                  case 0 :

                     /* Go to Go. */

                     TRANSFER_TO_NEW_SQUARE(0);
                     passed_go_count++;
                     break;

                  case 1 :

                     /* Go to Jail. */

                     TRANSFER_TO_NEW_SQUARE(40);
                     in_jail = 1;
                     break;

                  case 2 :

                     /* Get $10 in Beauty Contest */

                     comm_chest_money += 10;
                     break;

                  case 3 :

                     /* Get $45 for sale of stock. */

                     comm_chest_money += 45;
                     break;

                  case 4 :

                     /* Inherit $100 */

                     comm_chest_money += 100;
                     break;

                  case 5 :

                     /* Receive $25 for services. */

                     comm_chest_money += 25;
                     break;

                  case 6 :

                     /* Pay doctor's fee of $50. */

                     comm_chest_money -= 50;
                     break;

                  case 7 :

                     /* Bank error in your favor of $200. */

                     comm_chest_money += 200;
                     break;

                  case 8 :

                     /* Pay school tax of $150. */

                     comm_chest_money -= 150;
                     break;

                  case 9 :

                     /* Income tax refund of $20. */

                     comm_chest_money += 20;
                     break;

                  case 10 :

                     /* Pay hospital bill of $100. */

                     comm_chest_money -= 100;
                     break;

                  case 11 :

                     /* Life insurance matures for $100. */

                     comm_chest_money += 100;
                     break;

                  case 12 :

                     /* Xmas fund matures for $100. */

                     comm_chest_money += 100;
                     break;

                  default :

                     /* A card that leaves us on this square */
                     /* and that we do nothing else with.    */

                     break;
               }
            }
         }
      }
   }


void main()
   {

      printf("Enter number of rolls to simulate:\n");
      scanf("%lu", &limit);

      leave_jail = 1;

      initialize();

      do_calculation();

      print_probabilities("short jail stay");

      leave_jail = 3;

      initialize();

      do_calculation();

      print_probabilities("long jail stay");
   }
